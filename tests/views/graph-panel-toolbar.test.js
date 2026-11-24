// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Unit tests for the graph panel toolbar (locales, icon, lifecycle, actions).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Minimal JSDOM setup: HTMLElement/EventTarget globals are needed by ViewBase.
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLInputElement = dom.window.HTMLInputElement;
global.HTMLSelectElement = dom.window.HTMLSelectElement;
global.Node = dom.window.Node;
global.EventTarget = dom.window.EventTarget;
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';
import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';
import { AppEvent, AppPayload } from '../../src/micro_otter/nodes/html/js/core/app-event.js';

/** `node-updated` envelope the panel asserts before reading its patch. */
class NodeGraphNodeUpdatedPayload extends AppPayload {
    constructor(graphId, nodeId, patch) {
        super('NodeGraph.NodeUpdated.v1');
        this.graphId = graphId;
        this.nodeId = nodeId;
        this.patch = patch;
    }
}

/** `node-removed` envelope the connections UI asserts before reading its detail. */
class NodeGraphNodeRemovedPayload extends AppPayload {
    constructor(graphId, nodeId) {
        super('NodeGraph.NodeRemoved.v1');
        this.graphId = graphId;
        this.nodeId = nodeId;
    }
}

const testDir = path.dirname(fileURLToPath(import.meta.url));
const htmlRoot = path.resolve(testDir, '../../src/micro_otter/nodes/html');
const localeRoot = path.join(htmlRoot, 'locales');

function readLocale(name) {
    return JSON.parse(fs.readFileSync(path.join(localeRoot, `${name}.json`), 'utf8'));
}

function collectKeyPaths(value, prefix = '') {
    if (!value || typeof value !== 'object') {
        return [prefix];
    }
    return Object.entries(value).flatMap(([key, child]) =>
        collectKeyPaths(child, prefix ? `${prefix}.${key}` : key)
    );
}

describe('graph panel toolbar locales', () => {
    it('defines the align-to-grid keys in both locales', () => {
        for (const locale of ['en', 'de']) {
            const toolbar = readLocale(locale).graph?.toolbar;
            assert.ok(toolbar, `${locale}.json must define graph.toolbar`);
            assert.equal(typeof toolbar.alignToGrid, 'string');
            assert.equal(typeof toolbar.alignToGridUndo, 'string');
            assert.ok(toolbar.alignToGrid.length > 0, `${locale} alignToGrid must not be empty`);
            assert.ok(
                toolbar.alignToGridUndo.length > 0,
                `${locale} alignToGridUndo must not be empty`
            );
        }
    });

    it('keeps the graph.toolbar key sets identical across locales', () => {
        const enKeys = collectKeyPaths(readLocale('en').graph.toolbar).sort();
        const deKeys = collectKeyPaths(readLocale('de').graph.toolbar).sort();

        assert.deepEqual(deKeys, enKeys);
    });

    it('defines the execution-type and sleep-duration keys without empty values', () => {
        const expectedKeys = [
            'executionType.label',
            'executionType.loop',
            'executionType.startup',
            'signalMode.all',
            'signalMode.any',
            'signalMode.label',
            'signalNames.label',
            'signalNames.placeholder',
            'sleepDuration.label',
        ];

        for (const locale of ['en', 'de']) {
            const toolbar = readLocale(locale).graph.toolbar;
            const keys = collectKeyPaths(toolbar).sort();

            for (const key of expectedKeys) {
                assert.ok(keys.includes(key), `${locale}.json is missing graph.toolbar.${key}`);
            }

            for (const key of keys) {
                const value = key.split('.').reduce((node, part) => node[part], toolbar);
                assert.equal(typeof value, 'string', `${locale} graph.toolbar.${key}`);
                assert.ok(value.length > 0, `${locale} graph.toolbar.${key} must not be empty`);
            }
        }
    });

    it('labels the interval control for both locales', () => {
        assert.equal(readLocale('en').graph.toolbar.sleepDuration.label, 'Interval (ms)');
        assert.equal(readLocale('de').graph.toolbar.sleepDuration.label, 'Intervall (ms)');
    });
});

describe('graph panel toolbar icon', () => {
    it('registers the align-to-grid icon', () => {
        assert.ok(IconProvider.has('alignToGrid'));
        assert.equal(IconProvider.alignToGrid, IconProvider.get('alignToGrid'));
        assert.ok(IconProvider.getPath('alignToGrid').endsWith('/grid_on_24dp.svg'));
    });

    it('ships the grid icon asset with the theme tint', () => {
        const iconPath = path.join(htmlRoot, 'icons/grid_on_24dp.svg');

        assert.ok(fs.existsSync(iconPath), 'Expected icons/grid_on_24dp.svg to exist');

        const svg = fs.readFileSync(iconPath, 'utf8');
        assert.match(svg, /viewBox="0 0 24 24"/);
        assert.match(svg, /fill="#e3e3e3"/);
    });
});

function createI18nStub() {
    const translations = {
        'graph.toolbar.alignToGrid': 'Align nodes to grid',
        'graph.toolbar.alignToGridUndo': 'Align nodes to grid',
        'graph.toolbar.executionType.label': 'Execution Type',
        'graph.toolbar.executionType.startup': 'Startup',
        'graph.toolbar.executionType.loop': 'Loop',
        'graph.toolbar.executionType.irq': 'Interrupt',
        'graph.toolbar.executionType.event': 'Event',
        'graph.toolbar.executionType.function': 'Function',
        'graph.toolbar.sleepDuration.label': 'Interval (ms)',
        'graph.toolbar.triggerName.label': 'Interrupt',
        'graph.toolbar.signalNames.label': 'Signals',
        'graph.toolbar.signalNames.placeholder': 'Signals',
        'graph.toolbar.signalMode.label': 'Trigger mode',
        'graph.toolbar.signalMode.any': 'Any',
        'graph.toolbar.signalMode.all': 'All',
    };
    return {
        t: (key) => translations[key] ?? key,
        translations,
        addEventListener: () => {},
        removeEventListener: () => {},
    };
}

function createFakeGraph({
    nodeIds = ['node-a', 'node-b'],
    nodes = null,
    executionType = 'continuous',
    triggerInterval = 1000,
    enabled = true,
    triggerName = '',
    signalNames = [],
    signalMode = 'any',
} = {}) {
    const calls = {
        updateNode: [],
        setExecutionType: [],
        setTriggerInterval: [],
        setEnabled: [],
        setTriggerName: [],
        setSignalNames: [],
        setSignalMode: [],
    };
    const listeners = [];
    const state = { executionType, triggerInterval, enabled, triggerName, signalNames, signalMode };
    const nodeMap =
        nodes ||
        new Map([
            ['node-a', { id: 'node-a', x: 5, y: 3, width: 100, height: 50 }],
            ['node-b', { id: 'node-b', x: 40, y: 70, width: 100, height: 50 }],
        ]);

    return {
        id: 'graph-toolbar',
        calls,
        state,
        getName: () => 'Toolbar Graph',
        getNodeIds: () => [...nodeIds],
        getNode: (nodeId) => nodeMap.get(nodeId) || null,
        updateNode: (nodeId, patch) => {
            calls.updateNode.push({ nodeId, patch });
            const node = nodeMap.get(nodeId);
            if (node) {
                Object.assign(node, patch);
            }
        },
        getExecutionType: () => state.executionType,
        setExecutionType: (value) => {
            calls.setExecutionType.push(value);
            state.executionType = value;
        },
        getTriggerInterval: () => state.triggerInterval,
        setTriggerInterval: (value) => {
            calls.setTriggerInterval.push(value);
            state.triggerInterval = value;
        },
        getEnabled: () => state.enabled,
        setEnabled: (value) => {
            calls.setEnabled.push(value);
            state.enabled = value;
        },
        getTriggerName: () => state.triggerName,
        setTriggerName: (value) => {
            calls.setTriggerName.push(value);
            state.triggerName = value;
        },
        getSignalNames: () => state.signalNames,
        setSignalNames: (value) => {
            calls.setSignalNames.push(value);
            state.signalNames = value;
        },
        getSignalMode: () => state.signalMode,
        setSignalMode: (value) => {
            calls.setSignalMode.push(value);
            state.signalMode = value;
        },
        // `collectSignalNames()` walks the graph's nodes, so the map is the node source.
        getNodes: () => [...nodeMap.values()],
        on: (_eventName, listener) => {
            listeners.push(listener);
            return () => {};
        },
        emit: (event) => listeners.forEach((listener) => listener(event)),
    };
}

function createToolbarView(graph, { i18nService = createI18nStub() } = {}) {
    return new GraphPanelView({
        graph,
        collection: {
            getTargetId: () => null,
            getDeviceRuntimeId: () => 'general',
            getHistoryManager: () => null,
            getGraphArray: () => [],
        },
        i18nService,
        logger: { log: () => {} },
    });
}

function createContainer() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return container;
}

/**
 * Host element of the toolbar signals multi-select.
 * @param {HTMLElement} container - Panel container.
 * @returns {HTMLElement|null} The signals host.
 */
function signalHostOf(container) {
    return container.querySelector('.graph-panel-view__toolbar-control--signals');
}

/**
 * Trigger button of the toolbar signals multi-select.
 * @param {HTMLElement} container - Panel container.
 * @returns {HTMLButtonElement|null} The picker button.
 */
function signalButtonOf(container) {
    return signalHostOf(container)?.querySelector('.dropdown-control__button') || null;
}

/**
 * Trigger-mode select of the toolbar, addressed through the aria-label the panel applies.
 * @param {HTMLElement} container - Panel container.
 * @returns {HTMLSelectElement|null} The trigger-mode select.
 */
function modeSelectOf(container) {
    return container.querySelector('select[aria-label="Trigger mode"]');
}

/**
 * Menu element the signals multi-select appends to the document; the last match wins
 * because a view that failed to dispose would otherwise leave a stale menu behind.
 * @returns {HTMLElement|null} The portalled menu.
 */
function signalMenu() {
    const menus = document.querySelectorAll('.graph-panel-view__signal-menu');
    return menus[menus.length - 1] || null;
}

/**
 * Open the signals menu when it is closed.
 * @param {HTMLElement} container - Panel container.
 * @returns {HTMLElement|null} The open menu.
 */
function openSignalMenu(container) {
    const button = signalButtonOf(container);
    if (button && button.getAttribute('aria-expanded') !== 'true') {
        button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    }
    return signalMenu();
}

/**
 * Values of the options rendered in the signals menu, in menu order.
 * @param {HTMLElement} container - Panel container.
 * @returns {string[]} Option values.
 */
function signalOptionValues(container) {
    openSignalMenu(container);
    return [...signalMenu().querySelectorAll('.dropdown-control__option')].map((option) =>
        option.getAttribute('data-value')
    );
}

/**
 * Toggle one option in the signals menu.
 * @param {HTMLElement} container - Panel container.
 * @param {string} value - Option value to toggle.
 */
function clickSignalOption(container, value) {
    openSignalMenu(container);
    const option = signalMenu().querySelector(
        `.dropdown-control__option[data-value="${value}"]`
    );
    assert.ok(option, `missing signal option '${value}'`);
    option.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

describe('graph panel toolbar lifecycle', () => {
    it('mounts a single fixed-height toolbar inside the toolbar host', () => {
        const view = createToolbarView(createFakeGraph());
        const container = createContainer();

        view.attachTo(container);

        const toolbarHost = container.querySelector('.graph-panel-view__toolbar');
        assert.equal(toolbarHost.querySelectorAll('.view-toolbar').length, 1);

        const wrapper = toolbarHost.querySelector('.view-toolbar');
        assert.ok(wrapper.classList.contains('view-toolbar--scroll'));
        assert.equal(wrapper.style.minHeight, '36px');
        assert.equal(wrapper.style.maxHeight, '36px');

        view.dispose();
    });

    it('renders one align-to-grid button with localized label and icon', () => {
        const view = createToolbarView(createFakeGraph());
        const container = createContainer();

        view.attachTo(container);

        const controls = container.querySelector('.view-toolbar__controls');
        const buttons = controls.querySelectorAll('.view-toolbar__btn');
        assert.equal(buttons.length, 1);

        const button = buttons[0];
        assert.equal(button.title, 'Align nodes to grid');
        assert.equal(button.getAttribute('aria-label'), 'Align nodes to grid');

        const icon = button.querySelector('img');
        assert.ok(icon, 'Expected an icon image');
        assert.equal(icon.getAttribute('src'), IconProvider.alignToGrid);

        view.dispose();
    });

    it('separates the align button from the settings controls', () => {
        const view = createToolbarView(createFakeGraph());
        const container = createContainer();

        view.attachTo(container);

        const controls = container.querySelector('.view-toolbar__controls');
        const children = [...controls.children];
        const buttonIndex = children.findIndex((child) =>
            child.classList.contains('view-toolbar__btn')
        );
        const separatorIndex = children.findIndex(
            (child, index) =>
                index > buttonIndex && child.classList.contains('view-toolbar__separator')
        );

        assert.equal(
            separatorIndex,
            buttonIndex + 1,
            'Expected the separator right after the button'
        );
        assert.equal(
            children[separatorIndex + 1].className,
            'graph-panel-view__toolbar-control',
            'Expected the execution-type control after the separator'
        );
        assert.equal(controls.querySelectorAll('.view-toolbar__separator').length, 1);

        view.dispose();
    });

    it('disables the button without a graph and enables it once nodes exist', () => {
        const emptyView = createToolbarView(createFakeGraph({ nodeIds: [] }));
        const emptyContainer = createContainer();
        emptyView.attachTo(emptyContainer);
        assert.equal(
            emptyContainer.querySelector('.view-toolbar__btn').disabled,
            true,
            'Expected the button to be disabled for an empty graph'
        );
        emptyView.dispose();

        const noGraphView = createToolbarView(null);
        const noGraphContainer = createContainer();
        noGraphView.attachTo(noGraphContainer);
        assert.equal(noGraphView.graph, null);
        assert.equal(noGraphContainer.querySelector('.view-toolbar__btn').disabled, true);
        noGraphView.dispose();
    });

    it('does not duplicate the toolbar on re-attach and aligns once per click', () => {
        const graph = createFakeGraph();
        const view = createToolbarView(graph);
        const firstContainer = createContainer();
        const secondContainer = createContainer();

        view.attachTo(firstContainer);
        view.attachTo(secondContainer);

        assert.equal(
            secondContainer.querySelectorAll('.view-toolbar').length,
            1,
            'Expected exactly one toolbar after re-attach'
        );

        secondContainer.querySelector('.view-toolbar__btn').click();

        assert.equal(graph.calls.updateNode.length, 2, 'Expected one update per node');
        assert.deepEqual(graph.calls.updateNode[0], {
            nodeId: 'node-a',
            patch: { x: 0, y: 0 },
        });

        view.dispose();
    });

    it('detaches the toolbar on dispose so a later attach rebuilds it', () => {
        const view = createToolbarView(createFakeGraph());
        const firstContainer = createContainer();

        view.attachTo(firstContainer);
        const firstToolbar = firstContainer.querySelector('.view-toolbar');
        assert.ok(firstToolbar);

        view.dispose();
        assert.equal(firstContainer.querySelectorAll('.view-toolbar').length, 0);

        const secondContainer = createContainer();
        view.attachTo(secondContainer);

        const rebuilt = secondContainer.querySelectorAll('.view-toolbar');
        assert.equal(rebuilt.length, 1);
        assert.notEqual(rebuilt[0], firstToolbar, 'Expected a freshly built toolbar');
        assert.equal(secondContainer.querySelectorAll('.view-toolbar__btn').length, 1);

        view.dispose();
    });
});

function dispatch(element, type) {
    element.dispatchEvent(new dom.window.Event(type));
}

/**
 * Interval host of the compact toolbar, in the order: execution type, interrupt name,
 * signals, trigger mode, interval.
 * @param {HTMLElement} container - Panel container.
 * @returns {HTMLElement} The interval host element.
 */
function sleepHostOf(container) {
    return container.querySelectorAll('.graph-panel-view__toolbar-control')[4];
}

describe('graph panel toolbar controls', () => {
    it('renders the execution-type dropdown and the sleep input with bounds', () => {
        const view = createToolbarView(createFakeGraph());
        const container = createContainer();

        view.attachTo(container);

        const dropdowns = container.querySelectorAll('.custom-control--dropdown');
        assert.equal(dropdowns.length, 3, 'Expected execution type, interrupt name and mode');

        const select = dropdowns[0].querySelector('select');
        assert.ok(select, 'Expected a select element');
        assert.deepEqual(
            [...select.options].map((option) => option.value),
            ['startup', 'continuous', 'irq', 'event', 'function']
        );
        assert.deepEqual(
            [...select.options].map((option) => option.textContent),
            ['Startup', 'Loop', 'Interrupt', 'Event', 'Function']
        );
        assert.equal(
            dropdowns[0].querySelector('.custom-control__label').textContent,
            '',
            'Expected the dropdown to render without a visible title'
        );
        assert.equal(select.getAttribute('aria-label'), 'Execution Type');

        const numberInput = container.querySelector(
            '.custom-control--number .custom-control__input'
        );
        assert.ok(numberInput, 'Expected a number input');
        assert.equal(numberInput.type, 'number');
        assert.equal(numberInput.min, '0');
        assert.equal(numberInput.max, '60000');
        assert.equal(numberInput.step, '1');

        view.dispose();
    });

    it('commits a changed execution type to the graph once', () => {
        const graph = createFakeGraph();
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);

        const select = container.querySelector('.custom-control--dropdown select');
        select.value = 'startup';
        dispatch(select, 'change');

        assert.deepEqual(graph.calls.setExecutionType, ['startup']);

        // Selecting the already-active value must not write again.
        dispatch(select, 'change');
        assert.deepEqual(graph.calls.setExecutionType, ['startup']);

        view.dispose();
    });

    it('clamps the sleep duration on change and writes it back to the input', () => {
        const graph = createFakeGraph({ triggerInterval: 250 });
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);
        const input = container.querySelector('.custom-control--number .custom-control__input');

        input.value = '70000';
        dispatch(input, 'change');
        assert.deepEqual(graph.calls.setTriggerInterval, [60000]);
        assert.equal(input.value, '60000');

        input.value = '3';
        dispatch(input, 'blur');
        assert.deepEqual(graph.calls.setTriggerInterval, [60000, 3]);
        assert.equal(input.value, '3');

        input.value = '0';
        dispatch(input, 'change');
        assert.deepEqual(graph.calls.setTriggerInterval, [60000, 3, 0]);
        assert.equal(input.value, '0');

        input.value = '250.7';
        dispatch(input, 'change');
        assert.deepEqual(graph.calls.setTriggerInterval, [60000, 3, 0, 250]);
        assert.equal(input.value, '250');

        view.dispose();
    });

    it('restores the graph value for a blank field without writing', () => {
        const graph = createFakeGraph({ triggerInterval: 250 });
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);
        const input = container.querySelector('.custom-control--number .custom-control__input');

        input.value = '';
        dispatch(input, 'blur');
        assert.deepEqual(graph.calls.setTriggerInterval, []);
        assert.equal(input.value, '250');

        input.value = '';
        dispatch(input, 'change');
        assert.deepEqual(graph.calls.setTriggerInterval, []);
        assert.equal(input.value, '250');

        view.dispose();
    });

    it('ignores keystrokes that are not committed', () => {
        const graph = createFakeGraph({ triggerInterval: 250 });
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);
        const input = container.querySelector('.custom-control--number .custom-control__input');

        input.value = '500';
        dispatch(input, 'input');

        assert.deepEqual(graph.calls.setTriggerInterval, []);
        assert.equal(graph.getTriggerInterval(), 250);

        view.dispose();
    });

    it('hides the sleep and signal controls for run-once graphs', () => {
        const view = createToolbarView(createFakeGraph({ executionType: 'startup' }));
        const container = createContainer();

        view.attachTo(container);

        // Host order: execution type, interrupt name, signals, trigger mode, interval.
        const hosts = container.querySelectorAll('.graph-panel-view__toolbar-control');
        assert.equal(hosts.length, 5);
        assert.equal(hosts[1].hidden, true, 'Expected the interrupt control to be hidden');
        assert.equal(hosts[2].hidden, true, 'Expected the signals control to be hidden');
        assert.equal(hosts[3].hidden, true, 'Expected the trigger-mode control to be hidden');
        assert.equal(hosts[4].hidden, true, 'Expected the interval control to be hidden');

        view.dispose();
    });
});

describe('graph panel toolbar sync', () => {
    it('pulls the graph execution settings into the controls', () => {
        const view = createToolbarView(
            createFakeGraph({ executionType: 'startup', triggerInterval: 250 })
        );
        const container = createContainer();

        view.attachTo(container);
        view._syncToolbarControls();

        const select = container.querySelector('.custom-control--dropdown select');
        const input = container.querySelector('.custom-control--number .custom-control__input');

        assert.equal(select.value, 'startup');
        assert.equal(input.value, '250');
        assert.equal(sleepHostOf(container).hidden, true);

        view.dispose();
    });

    it('mirrors executionType and interval events from the graph', () => {
        const graph = createFakeGraph();
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);

        graph.state.executionType = 'startup';
        graph.emit({ name: 'executionType', detail: { executionType: 'startup' } });

        assert.equal(container.querySelector('.custom-control--dropdown select').value, 'startup');
        assert.equal(sleepHostOf(container).hidden, true);

        graph.state.executionType = 'continuous';
        graph.state.triggerInterval = 500;
        graph.emit({ name: 'interval', detail: { interval: 500 } });

        assert.equal(container.querySelector('.custom-control--dropdown select').value, 'continuous');
        assert.equal(
            container.querySelector('.custom-control--number .custom-control__input').value,
            '500'
        );

        view.dispose();
    });

    it('clamps corrupt graph state when pulling', () => {
        const graph = createFakeGraph({ triggerInterval: 5 });
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);
        assert.equal(
            container.querySelector('.custom-control--number .custom-control__input').value,
            '5'
        );

        graph.state.triggerInterval = -7;
        view._syncToolbarControls();
        assert.equal(
            container.querySelector('.custom-control--number .custom-control__input').value,
            '0'
        );

        graph.state.triggerInterval = 999999;
        view._syncToolbarControls();
        assert.equal(
            container.querySelector('.custom-control--number .custom-control__input').value,
            '60000'
        );

        view.dispose();
    });

    it('disables all controls when the graph is removed', () => {
        const view = createToolbarView(createFakeGraph());
        const container = createContainer();

        view.attachTo(container);
        view.setGraph(null);

        assert.equal(container.querySelector('.custom-control--dropdown select').disabled, true);
        assert.equal(
            container.querySelector('.custom-control--number .custom-control__input').disabled,
            true
        );
        assert.equal(signalHostOf(container).hidden, true);
        assert.equal(signalButtonOf(container).disabled, true);
        assert.equal(modeSelectOf(container).disabled, true);

        view.dispose();
    });

    it('refreshes control labels on a language change without touching values', () => {
        const i18nService = createI18nStub();
        const view = createToolbarView(createFakeGraph({ triggerInterval: 750 }), { i18nService });
        const container = createContainer();

        view.attachTo(container);

        i18nService.translations['graph.toolbar.executionType.label'] = 'Ausführungstyp';
        i18nService.translations['graph.toolbar.executionType.startup'] = 'Start';
        i18nService.translations['graph.toolbar.executionType.loop'] = 'Schleife';
        i18nService.translations['graph.toolbar.sleepDuration.label'] = 'Pause (ms)';
        view._refreshToolbarControlLabels();

        const select = container.querySelector('.custom-control--dropdown select');

        assert.equal(select.getAttribute('aria-label'), 'Ausführungstyp');
        assert.equal(
            sleepHostOf(container).querySelector('.custom-control__label').textContent,
            'Pause (ms)'
        );
        assert.equal(select.options[0].textContent, 'Start');
        assert.equal(select.options[1].textContent, 'Schleife');
        assert.equal(select.value, 'continuous');
        assert.equal(
            container.querySelector('.custom-control--number .custom-control__input').value,
            '750'
        );

        view.dispose();
    });
});

describe('disabled canvas styling', () => {
    const getCanvasHost = (container) => container.querySelector('.graph-panel-view__canvas');

    it('marks the canvas host for a disabled graph', () => {
        const view = createToolbarView(createFakeGraph({ enabled: false }));
        const container = createContainer();

        view.attachTo(container);

        assert.ok(getCanvasHost(container).classList.contains('graph-panel-view__canvas--disabled'));

        view.dispose();
    });

    it('clears the marker when the graph is enabled again', () => {
        const graph = createFakeGraph({ enabled: true });
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);
        assert.equal(
            getCanvasHost(container).classList.contains('graph-panel-view__canvas--disabled'),
            false
        );

        graph.state.enabled = false;
        graph.emit({ name: 'enabled', detail: { enabled: false } });
        assert.ok(getCanvasHost(container).classList.contains('graph-panel-view__canvas--disabled'));

        graph.state.enabled = true;
        graph.emit({ name: 'enabled', detail: { enabled: true } });
        assert.equal(
            getCanvasHost(container).classList.contains('graph-panel-view__canvas--disabled'),
            false
        );

        view.dispose();
    });

    it('never marks the canvas of a graph without an enabled accessor', () => {
        const graph = createFakeGraph();
        delete graph.getEnabled;
        delete graph.setEnabled;

        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);

        assert.equal(
            getCanvasHost(container).classList.contains('graph-panel-view__canvas--disabled'),
            false
        );

        view.dispose();
    });

    it('lists all execution options in order', () => {
        const view = createToolbarView(createFakeGraph());
        const container = createContainer();
        view.attachTo(container);

        const select = container.querySelector('.custom-control--dropdown select');
        assert.deepEqual(
            [...select.options].map((option) => option.value),
            ['startup', 'continuous', 'irq', 'event', 'function']
        );

        view.dispose();
    });

    it('selecting irq writes the execution type and hides the interval host', () => {
        const graph = createFakeGraph();
        const view = createToolbarView(graph);
        const container = createContainer();
        view.attachTo(container);

        const select = container.querySelector('.custom-control--dropdown select');
        select.value = 'irq';
        dispatch(select, 'change');

        assert.deepEqual(graph.calls.setExecutionType, ['irq']);
        assert.equal(sleepHostOf(container).hidden, true, 'interval host hidden for irq');

        select.value = 'continuous';
        dispatch(select, 'change');
        assert.equal(sleepHostOf(container).hidden, false, 'interval host returns for continuous');

        view.dispose();
    });

    it('updates the irq option text on a language change', () => {
        const i18nService = createI18nStub();
        const view = createToolbarView(createFakeGraph(), { i18nService });
        const container = createContainer();
        view.attachTo(container);

        i18nService.translations['graph.toolbar.executionType.irq'] = 'Interrupt (de)';
        view._refreshToolbarControlLabels();

        const select = container.querySelector('.custom-control--dropdown select');
        assert.equal(select.options[2].textContent, 'Interrupt (de)');

        view.dispose();
    });

    it('selecting event writes the execution type and hides the interval host', () => {
        const graph = createFakeGraph();
        const view = createToolbarView(graph);
        const container = createContainer();
        view.attachTo(container);

        const select = container.querySelector('.custom-control--dropdown select');
        select.value = 'event';
        dispatch(select, 'change');

        assert.deepEqual(graph.calls.setExecutionType, ['event']);
        assert.equal(sleepHostOf(container).hidden, true, 'interval host hidden for event');

        select.value = 'continuous';
        dispatch(select, 'change');
        assert.equal(sleepHostOf(container).hidden, false, 'interval host returns for continuous');

        view.dispose();
    });

    it('updates the event option text on a language change', () => {
        const i18nService = createI18nStub();
        const view = createToolbarView(createFakeGraph(), { i18nService });
        const container = createContainer();
        view.attachTo(container);

        i18nService.translations['graph.toolbar.executionType.event'] = 'Ereignis';
        view._refreshToolbarControlLabels();

        const select = container.querySelector('.custom-control--dropdown select');
        assert.equal(select.options[3].textContent, 'Ereignis');

        view.dispose();
    });
});

describe('graph panel toolbar signal controls', () => {
    /**
     * A `signal-post` graph node as `collectSignalNames()` reads it.
     * @param {string} name - Signal the node posts.
     * @returns {object} Graph node record.
     */
    function signalPostNode(name) {
        return { id: `sig-${name}`, type: 'signal-post', controlValues: { signal: name } };
    }

    /**
     * Event graph whose node map holds the given signal names.
     * @param {string[]} [names] - Signals posted by the graph.
     * @returns {object} Fake graph.
     */
    function createEventGraph(names = []) {
        const nodes = new Map(names.map((name) => [`sig-${name}`, signalPostNode(name)]));
        // No node ids: the panel must not build node UIs for these bare records.
        return createFakeGraph({ executionType: 'event', nodeIds: [], nodes });
    }

    it('offers the declared signals in order and enables both controls', () => {
        const graph = createEventGraph(['radar', 'beacon']);
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);

        assert.equal(signalHostOf(container).hidden, false);
        assert.equal(signalButtonOf(container).getAttribute('aria-label'), 'Signals');
        assert.equal(signalButtonOf(container).disabled, false);
        assert.equal(modeSelectOf(container).disabled, false);
        assert.equal(modeSelectOf(container).value, 'any');
        assert.deepEqual(signalOptionValues(container), ['beacon', 'radar']);

        view.dispose();
    });

    it('keeps both controls hidden and disabled outside event mode', () => {
        const graph = createFakeGraph({
            executionType: 'continuous',
            nodeIds: [],
            nodes: new Map([['sig-radar', signalPostNode('radar')]]),
        });
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);

        assert.equal(signalHostOf(container).hidden, true);
        assert.equal(signalButtonOf(container).disabled, true);
        assert.equal(modeSelectOf(container).disabled, true);

        view.dispose();
    });

    it('disables the picker while no signal is declared', () => {
        const graph = createEventGraph();
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);

        assert.equal(signalHostOf(container).hidden, false);
        assert.equal(signalButtonOf(container).disabled, true);
        assert.equal(modeSelectOf(container).disabled, false);

        view.dispose();
    });

    it('writes a picked signal into the graph and badges the trigger', () => {
        const graph = createEventGraph(['radar']);
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);
        clickSignalOption(container, 'radar');

        assert.deepEqual(graph.calls.setSignalNames, [['radar']]);
        assert.equal(
            signalButtonOf(container).querySelector('.dropdown-control__button-badge').textContent,
            '(1)'
        );

        clickSignalOption(container, 'radar');

        assert.deepEqual(graph.calls.setSignalNames, [['radar'], []]);

        view.dispose();
    });

    it('writes the trigger mode once', () => {
        const graph = createEventGraph(['radar']);
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);

        const select = modeSelectOf(container);
        assert.equal(select.options.length, 2);
        assert.deepEqual(
            [...select.options].map((option) => option.textContent),
            ['Any', 'All']
        );

        select.value = 'all';
        dispatch(select, 'change');
        assert.deepEqual(graph.calls.setSignalMode, ['all']);

        select.value = 'all';
        dispatch(select, 'change');
        assert.deepEqual(graph.calls.setSignalMode, ['all'], 'Expected no second write');

        view.dispose();
    });

    it('mirrors signalTrigger events from the graph without writing back', () => {
        const graph = createEventGraph(['radar', 'beacon']);
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);

        graph.state.signalNames = ['radar'];
        graph.state.signalMode = 'all';
        graph.emit({ name: 'signalTrigger' });

        assert.equal(modeSelectOf(container).value, 'all');
        assert.equal(
            signalButtonOf(container).querySelector('.dropdown-control__button-badge').textContent,
            '(1)'
        );
        assert.deepEqual(graph.calls.setSignalNames, [], 'Expected no echo write');
        assert.deepEqual(graph.calls.setSignalMode, [], 'Expected no echo write');

        view.dispose();
    });

    it('rebuilds the options when a signal-post node is added or removed', () => {
        const graph = createEventGraph(['radar']);
        const nodes = new Map([['sig-radar', signalPostNode('radar')]]);
        graph.getNodes = () => [...nodes.values()];
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);
        assert.deepEqual(signalOptionValues(container), ['radar']);

        nodes.set('sig-beacon', signalPostNode('beacon'));
        graph.emit({ name: 'node-added' });
        assert.deepEqual(signalOptionValues(container), ['beacon', 'radar']);

        nodes.delete('sig-radar');
        graph.emit(
            new AppEvent(
                'node-removed',
                new NodeGraphNodeRemovedPayload('graph-toolbar', 'sig-radar')
            )
        );
        assert.deepEqual(signalOptionValues(container), ['beacon']);

        view.dispose();
    });

    it('rebuilds the options only for node-updated patches touching a signal control', () => {
        const graph = createEventGraph(['radar']);
        const nodes = new Map([['sig-radar', signalPostNode('radar')]]);
        graph.getNodes = () => [...nodes.values()];
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);
        const buttonBefore = signalButtonOf(container);

        graph.emit(
            new AppEvent(
                'node-updated',
                new NodeGraphNodeUpdatedPayload('graph-toolbar', 'sig-radar', { x: 40 })
            )
        );
        assert.equal(
            signalButtonOf(container),
            buttonBefore,
            'A position patch must not rebuild the picker'
        );

        nodes.set('sig-radar', signalPostNode('motion'));
        graph.emit(
            new AppEvent(
                'node-updated',
                new NodeGraphNodeUpdatedPayload('graph-toolbar', 'sig-radar', {
                    controlValues: { signal: 'motion' },
                })
            )
        );
        assert.notEqual(signalButtonOf(container), buttonBefore);
        assert.deepEqual(signalOptionValues(container), ['motion']);

        view.dispose();
    });

    it('keeps an open menu open when a signalTrigger refresh arrives', () => {
        const graph = createEventGraph(['radar']);
        const view = createToolbarView(graph);
        const container = createContainer();

        view.attachTo(container);
        openSignalMenu(container);
        assert.equal(signalButtonOf(container).getAttribute('aria-expanded'), 'true');

        graph.emit({ name: 'signalTrigger' });

        assert.equal(
            signalButtonOf(container).getAttribute('aria-expanded'),
            'true',
            'A refresh with unchanged options must not close the menu'
        );
        assert.deepEqual(signalOptionValues(container), ['radar']);

        view.dispose();
    });

    it('translates the picker labels on a language change', () => {
        const graph = createEventGraph(['radar']);
        const i18nService = createI18nStub();
        const view = createToolbarView(graph, { i18nService });
        const container = createContainer();

        view.attachTo(container);

        i18nService.translations['graph.toolbar.signalNames.label'] = 'Signale';
        i18nService.translations['graph.toolbar.signalNames.placeholder'] = 'Signale';
        i18nService.translations['graph.toolbar.signalMode.label'] = 'Auslösemodus';
        i18nService.translations['graph.toolbar.signalMode.any'] = 'Beliebig';
        i18nService.translations['graph.toolbar.signalMode.all'] = 'Alle';
        view._refreshToolbarControlLabels();

        const select = container.querySelector('select[aria-label="Auslösemodus"]');
        assert.ok(select, 'Expected the translated trigger-mode aria-label');
        assert.deepEqual(
            [...select.options].map((option) => option.textContent),
            ['Beliebig', 'Alle']
        );
        assert.equal(signalButtonOf(container).getAttribute('aria-label'), 'Signale');
        assert.equal(signalButtonOf(container).querySelector('.dropdown-control__button-label').textContent, 'Signale');

        view.dispose();
    });
});
