// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Collection graph tabs must expose their execution type as a tab variant.
 *
 * Active graphs provide `GraphPanelView.tabVariant`; inactive graph placeholders
 * provide the same hook from their captured graph. Both normalize through
 * `normalizeExecutionType()` and repaint on the graph's `executionType` event.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { AppEvent, AppPayload } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import { CollectionView } from '../../src/micro_otter/nodes/html/js/views/collection-view.js';

class MockPayload extends AppPayload {
    constructor(payloadTypeId, detail = {}) {
        super(payloadTypeId);
        Object.assign(this, detail);
    }
}

/**
 * Build a graph stub whose execution-type changes emit a real graph event.
 * @param {string} id Graph id.
 * @param {string} name Graph name.
 * @param {string} executionType Initial execution type.
 * @returns {object} Graph stub.
 */
function createGraphStub(id, name, executionType = 'continuous') {
    const listeners = new Set();
    const state = { id, name, executionType, triggerIntervalMs: 500 };

    return {
        getId: () => state.id,
        getName: () => state.name,
        setName: (next) => {
            state.name = next;
        },
        getNodeIds: () => [],
        getNodes: () => [],
        getNode: () => null,
        getConnections: () => [],
        getExecutionType: () => state.executionType,
        setExecutionType: (value) => {
            state.executionType = value;
            const event = new AppEvent(
                'executionType',
                new MockPayload('NodeGraph.ExecutionTypeChanged.v1', {
                    graphId: state.id,
                    executionType: value,
                })
            );
            listeners.forEach((listener) => listener(event));
        },
        getTriggerInterval: () => state.triggerIntervalMs,
        setTriggerInterval: (value) => {
            state.triggerIntervalMs = value;
        },
        getEnabled: () => true,
        setEnabled: () => {},
        on: (_eventName, listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

/**
 * Build the collection stub required by CollectionView.
 * @param {object[]} graphs Graphs in the collection.
 * @returns {object} Collection stub.
 */
function createCollectionStub(graphs) {
    const listeners = new Set();
    let activeGraphIdx = 0;

    return {
        getId: () => 'collection-1',
        getTitle: () => 'Tab Variant Collection',
        getTargetId: () => null,
        getDeviceRuntimeId: () => 'general',
        getHistoryManager: () => null,
        getGraphArray: () => graphs.slice(),
        getGraphById: (id) => graphs.find((graph) => graph.getId() === id) || null,
        getActiveGraph: () => graphs[activeGraphIdx] || null,
        getActiveGraphIdx: () => activeGraphIdx,
        setActiveGraphIdx: (idx) => {
            activeGraphIdx = idx;
            listeners.forEach((listener) =>
                listener(
                    new AppEvent(
                        'activeGraphIdx',
                        new MockPayload('Collection.ActiveGraphIndexChanged.v1', {
                            collectionId: 'collection-1',
                            activeGraphIdx: idx,
                        })
                    )
                )
            );
        },
        addGraph: (graph) => {
            graphs.push(graph);
        },
        removeGraph: (graphId) => {
            const index = graphs.findIndex((graph) => graph.getId() === graphId);
            if (index < 0) {
                return false;
            }
            graphs.splice(index, 1);
            return true;
        },
        getUniqueGraphName: () => 'Graph 1',
        getUniqueGraphId: () => 'graph-1',
        on: (_eventName, listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        emit: (event) => listeners.forEach((listener) => listener(event)),
    };
}

describe('CollectionView graph tab variants', () => {
    let dom;
    let container;

    const i18nStub = {
        t: (key) => key,
        addEventListener: () => {},
        removeEventListener: () => {},
    };

    /**
     * Create and attach a CollectionView over the supplied graphs.
     * @param {object[]} graphs Graphs in the collection.
     * @returns {{view: CollectionView, collection: object}} Attached view and its collection.
     */
    function createView(graphs) {
        const collection = createCollectionStub(graphs);
        const workspace = {
            getActiveCollection: () => collection,
            config: {},
        };

        const view = new CollectionView({
            collection,
            workspace,
            viewManager: { showModal: () => {}, showConfirmation: async () => true },
            i18nService: i18nStub,
            logger: { log: () => {} },
        });

        view.attachTo(container);
        return { view, collection };
    }

    /**
     * Look up a rendered graph tab by view id.
     * @param {string} viewId Graph id.
     * @returns {HTMLElement} Tab element.
     */
    function tabFor(viewId) {
        const tab = container.querySelector(`.tabbed-view__tab[data-view-id="${viewId}"]`);
        assert.ok(tab, `tab ${viewId} must be rendered`);
        return tab;
    }

    /**
     * Read the variant token from a tab.
     * @param {string} viewId Graph id.
     * @returns {string|null} The `data-tab-variant` value, or null when absent.
     */
    function variantFor(viewId) {
        return tabFor(viewId).getAttribute('data-tab-variant');
    }

    /**
     * Build one graph for each supported execution type.
     * @returns {object[]} Graph stubs in type order.
     */
    function createTypedGraphs() {
        return [
            createGraphStub('startup-graph', 'Startup', 'startup'),
            createGraphStub('continuous-graph', 'Loop', 'continuous'),
            createGraphStub('irq-graph', 'Interrupt', 'irq'),
            createGraphStub('event-graph', 'Event', 'event'),
            createGraphStub('function-graph', 'Function', 'function'),
        ];
    }

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.EventTarget = dom.window.EventTarget;
        global.CustomEvent = dom.window.CustomEvent;
        global.HTMLInputElement = dom.window.HTMLInputElement;
        global.requestAnimationFrame = () => 0;
        global.cancelAnimationFrame = () => {};
        global.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        dom.window.close();
        global.window = undefined;
        global.document = undefined;
    });

    it('maps each graph execution type to its tab variant', () => {
        const { view } = createView(createTypedGraphs());

        assert.equal(variantFor('startup-graph'), 'startup');
        assert.equal(variantFor('continuous-graph'), 'continuous');
        assert.equal(variantFor('irq-graph'), 'irq');
        assert.equal(variantFor('event-graph'), 'event');
        assert.equal(variantFor('function-graph'), 'function');

        view.detach();
    });

    it('gives the active graph tab its own execution type', () => {
        const { view } = createView(createTypedGraphs());

        assert.equal(view.activeId, 'startup-graph');
        assert.equal(variantFor('startup-graph'), 'startup');
        assert.equal(tabFor('startup-graph').classList.contains('is-active'), true);

        view.detach();
    });

    it('repaints only the inactive graph tab when its execution type changes', () => {
        const { view, collection } = createView(createTypedGraphs());

        assert.equal(variantFor('continuous-graph'), 'continuous');
        assert.equal(variantFor('irq-graph'), 'irq');

        collection.getGraphById('continuous-graph').setExecutionType('irq');

        assert.equal(variantFor('continuous-graph'), 'irq');
        assert.equal(variantFor('startup-graph'), 'startup');
        assert.equal(variantFor('irq-graph'), 'irq');
        assert.equal(variantFor('event-graph'), 'event');

        view.detach();
    });

    it('repaints the active graph tab when its execution type changes', () => {
        const { view, collection } = createView(createTypedGraphs());

        assert.equal(variantFor('startup-graph'), 'startup');

        collection.getGraphById('startup-graph').setExecutionType('event');

        assert.equal(variantFor('startup-graph'), 'event');

        view.detach();
    });

    it('falls back to continuous for an unknown stored execution type', () => {
        const { view } = createView([createGraphStub('unknown-graph', 'Unknown', 'mystery')]);

        assert.equal(variantFor('unknown-graph'), 'continuous');

        view.detach();
    });

    it('keeps view ids and labels unchanged on every tab', () => {
        const { view } = createView(createTypedGraphs());

        const expected = new Map([
            ['startup-graph', 'Startup'],
            ['continuous-graph', 'Loop'],
            ['irq-graph', 'Interrupt'],
            ['event-graph', 'Event'],
            ['function-graph', 'Function'],
        ]);

        for (const [id, label] of expected) {
            const tab = tabFor(id);
            assert.equal(tab.dataset.viewId, id);
            assert.equal(tab.querySelector('.tabbed-view__tab-label').textContent, label);
        }

        view.detach();
    });
});
