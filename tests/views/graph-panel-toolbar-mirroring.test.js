// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Cross-surface mirroring tests: graph panel toolbar <-> GraphSettingsView.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLInputElement = dom.window.HTMLInputElement;
global.HTMLSelectElement = dom.window.HTMLSelectElement;
global.Node = dom.window.Node;
global.CustomEvent = dom.window.CustomEvent;
global.EventTarget = dom.window.EventTarget;
global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
};
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';
import { GraphSettingsView } from '../../src/micro_otter/nodes/html/js/views/graph-settings-view.js';

const translations = {
    'graph.toolbar.alignToGrid': 'Align nodes to grid',
    'graph.toolbar.alignToGridUndo': 'Align nodes to grid',
    'graph.toolbar.executionType.label': 'Execution Type',
    'graph.toolbar.executionType.startup': 'Startup',
    'graph.toolbar.executionType.loop': 'Loop',
    'graph.toolbar.executionType.irq': 'Interrupt',
    'graph.toolbar.executionType.event': 'Event',
    'graph.toolbar.sleepDuration.label': 'Interval (ms)',
    'graph.toolbar.triggerName.label': 'Interrupt',
    'graph.toolbar.signalNames.label': 'Signals',
    'graph.toolbar.signalNames.placeholder': 'Signals',
    'graph.toolbar.signalMode.label': 'Trigger mode',
    'graph.toolbar.signalMode.any': 'Any',
    'graph.toolbar.signalMode.all': 'All',
    'settings.graph.enabled.label': 'Enabled',
};

const i18nStub = {
    t: (key) => translations[key] ?? key,
    addEventListener: () => {},
    removeEventListener: () => {},
};

function createCollectionStub() {
    return {
        getTargetId: () => null,
        getDeviceRuntimeId: () => 'general',
        getHistoryManager: () => null,
    };
}

function createPanelView(graph) {
    return new GraphPanelView({
        graph,
        collection: createCollectionStub(),
        i18nService: i18nStub,
        logger: { log: () => {} },
    });
}

function attachPanel(graph) {
    const view = createPanelView(graph);
    const container = document.createElement('div');
    document.body.appendChild(container);
    view.attachTo(container);

    return {
        view,
        container,
        cleanup() {
            view.dispose();
            container.remove();
        },
    };
}

function selectOf(container) {
    return container.querySelector('.custom-control--dropdown select');
}

function sleepInputOf(container) {
    return container.querySelector('.custom-control--number .custom-control__input');
}

function sleepHostOf(container) {
    // Derived from the input itself: the toolbar order may grow as controls are added.
    return sleepInputOf(container).closest('.graph-panel-view__toolbar-control');
}

/**
 * Trigger button of the toolbar signals multi-select.
 * @param {HTMLElement} container - Panel container.
 * @returns {HTMLButtonElement|null} The picker button.
 */
function signalButtonOf(container) {
    return container.querySelector(
        '.graph-panel-view__toolbar-control--signals .dropdown-control__button'
    );
}

/**
 * Trigger-mode select of the toolbar (untitled, named through its aria-label).
 * @param {HTMLElement} container - Panel container.
 * @returns {HTMLSelectElement|null} The trigger-mode select.
 */
function modeSelectOf(container) {
    return container.querySelector('select[aria-label="Trigger mode"]');
}

/**
 * Toggle one option in the portalled signals menu, opening it first.
 * @param {HTMLElement} container - Panel container.
 * @param {string} value - Option value to toggle.
 */
function clickSignalOption(container, value) {
    const button = signalButtonOf(container);
    if (button.getAttribute('aria-expanded') !== 'true') {
        button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    }
    const menus = document.querySelectorAll('.graph-panel-view__signal-menu');
    const menu = menus[menus.length - 1];
    const option = menu.querySelector(`.dropdown-control__option[data-value="${value}"]`);
    assert.ok(option, `missing signal option '${value}'`);
    option.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

function dispatch(element, type) {
    element.dispatchEvent(new dom.window.Event(type));
}

describe('graph panel toolbar <-> graph model', () => {
    it('writes toolbar selections into the graph', () => {
        const graph = new NodeGraph({ id: 'graph-mirror', triggerIntervalMs: 1000 });
        const { container, cleanup } = attachPanel(graph);

        const select = selectOf(container);
        select.value = 'startup';
        dispatch(select, 'change');
        assert.equal(graph.getExecutionType(), 'startup');

        const input = sleepInputOf(container);
        input.value = '750';
        dispatch(input, 'change');
        assert.equal(graph.getTriggerInterval(), 750);

        cleanup();
    });

    it('follows execution-type changes made in the settings view', () => {
        const graph = new NodeGraph({ id: 'graph-mirror' });
        const { container, cleanup } = attachPanel(graph);

        // Duck-typed settings view: only the members used by the handler.
        const settingsViewLike = {
            _graph: graph,
            _updateSleepVisibility: () => {},
            _updateTriggerVisibility: () => {},
            _updateSignalsVisibility: () => {},
            _refreshFunctionControls: () => {},
        };
        GraphSettingsView.prototype._handleExecutionTypeChanged.call(
            settingsViewLike,
            'startup'
        );

        assert.equal(graph.getExecutionType(), 'startup');
        assert.equal(selectOf(container).value, 'startup');
        assert.equal(sleepHostOf(container).hidden, true);

        cleanup();
    });

    it('follows interval changes made in the settings view', () => {
        const graph = new NodeGraph({ id: 'graph-mirror', triggerIntervalMs: 1000 });
        const { container, cleanup } = attachPanel(graph);

        graph.setTriggerInterval(400);

        assert.equal(sleepInputOf(container).value, '400');

        cleanup();
    });

    it('shows persisted execution settings loaded from data', () => {
        const graph = NodeGraph.fromData({
            id: 'graph-persisted',
            executionType: 'startup',
            triggerIntervalMs: 50000,
        });

        assert.equal(graph.getExecutionType(), 'startup');
        assert.equal(graph.getTriggerInterval(), 50000);

        const { container, cleanup } = attachPanel(graph);

        assert.equal(selectOf(container).value, 'startup');
        assert.equal(sleepInputOf(container).value, '50000');
        assert.equal(sleepHostOf(container).hidden, true);

        cleanup();
    });

    it('does not rewrite an unchanged sleep duration', () => {
        const graph = new NodeGraph({ id: 'graph-mirror', triggerIntervalMs: 1000 });
        const { view, container, cleanup } = attachPanel(graph);

        const originalSetTriggerInterval = graph.setTriggerInterval.bind(graph);
        let writes = 0;
        graph.setTriggerInterval = (value) => {
            writes += 1;
            return originalSetTriggerInterval(value);
        };

        const input = sleepInputOf(container);
        input.value = '1000';
        dispatch(input, 'change');
        dispatch(input, 'blur');

        assert.equal(writes, 0, 'Expected no write for an unchanged value');

        input.value = '1200';
        dispatch(input, 'change');
        dispatch(input, 'blur');

        assert.equal(writes, 1, 'Expected exactly one write for a changed value');
        assert.equal(graph.getTriggerInterval(), 1200);

        view._handleToolbarSleepCommit();
        assert.equal(writes, 1, 'Re-committing the same value must not write again');

        cleanup();
    });

    /**
     * Event graph that declares one `signal-post` signal named `radar`.
     * @returns {NodeGraph} Graph with a signal name the picker can offer.
     */
    function createEventGraphWithSignal() {
        const graph = new NodeGraph({ id: 'graph-signals', executionType: 'event' });
        // The picker reads declared names through `getNodes()`; the graph itself has none.
        graph.getNodes = () => [
            { id: 'sig-radar', type: 'signal-post', controlValues: { signal: 'radar' } },
        ];
        return graph;
    }

    it('writes toolbar signal picks and the trigger mode into the graph', () => {
        const graph = createEventGraphWithSignal();
        const { container, cleanup } = attachPanel(graph);

        assert.equal(signalButtonOf(container).disabled, false);

        clickSignalOption(container, 'radar');
        assert.deepEqual(graph.getSignalNames(), ['radar']);

        const mode = modeSelectOf(container);
        mode.value = 'all';
        dispatch(mode, 'change');
        assert.equal(graph.getSignalMode(), 'all');

        cleanup();
    });

    it('follows signal changes made outside the panel', () => {
        const graph = createEventGraphWithSignal();
        const { container, cleanup } = attachPanel(graph);

        graph.setSignalNames(['radar']);
        graph.setSignalMode('all');

        assert.equal(
            signalButtonOf(container).querySelector('.dropdown-control__button-badge').textContent,
            '(1)'
        );
        assert.equal(modeSelectOf(container).value, 'all');

        graph.setSignalNames([]);
        assert.equal(
            signalButtonOf(container).querySelector('.dropdown-control__button-badge'),
            null
        );

        cleanup();
    });
});

describe('graph enabled flag mirroring', () => {
    function createCollectionManagerStub(graph) {
        return {
            getActiveCollection: () => ({
                getActiveGraph: () => graph,
                on: () => () => {},
            }),
            on: () => () => {},
        };
    }

    function attachBothViews(graph) {
        const panelView = createPanelView(graph);
        const panelContainer = document.createElement('div');
        document.body.appendChild(panelContainer);
        panelView.attachTo(panelContainer);

        const settingsView = new GraphSettingsView({
            collectionManager: createCollectionManagerStub(graph),
            i18nService: i18nStub,
            logger: { log: () => {} },
        });
        const settingsContainer = document.createElement('div');
        document.body.appendChild(settingsContainer);
        settingsView.attachTo(settingsContainer);

        return {
            panelContainer,
            settingsContainer,
            settingsCheckbox: () =>
                settingsContainer.querySelector(
                    '.custom-control--checkbox .custom-control__checkbox'
                ),
            canvasHost: () => panelContainer.querySelector('.graph-panel-view__canvas'),
            cleanup() {
                panelView.dispose();
                settingsView.detach();
                panelContainer.remove();
                settingsContainer.remove();
            },
        };
    }

    it('mirrors a settings toggle into the canvas', () => {
        const graph = new NodeGraph({ id: 'graph-enabled' });
        const views = attachBothViews(graph);

        assert.equal(views.settingsCheckbox().checked, true);

        views.settingsCheckbox().checked = false;
        dispatch(views.settingsCheckbox(), 'change');

        assert.equal(graph.getEnabled(), false);
        assert.equal(views.settingsCheckbox().checked, false);
        assert.ok(views.canvasHost().classList.contains('graph-panel-view__canvas--disabled'));

        views.cleanup();
    });

    it('reaches the settings checkbox and canvas when an outside consumer toggles the graph', () => {
        const graph = new NodeGraph({ id: 'graph-enabled' });
        const views = attachBothViews(graph);

        // e.g. an undo snapshot restore or a programmatic command
        graph.setEnabled(false);

        assert.equal(views.settingsCheckbox().checked, false);
        assert.ok(views.canvasHost().classList.contains('graph-panel-view__canvas--disabled'));

        graph.setEnabled(true);

        assert.equal(views.settingsCheckbox().checked, true);
        assert.equal(
            views.canvasHost().classList.contains('graph-panel-view__canvas--disabled'),
            false
        );

        views.cleanup();
    });
});
