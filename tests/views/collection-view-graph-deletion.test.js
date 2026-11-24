// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Tests for graph deletion in the collection view.
 *
 * Graph tabs are no longer closable, deletion goes through
 * `CollectionManager.removeGraph()`, and a data-first removal re-syncs the active graph.
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

function createGraphStub(id, name) {
    const listeners = new Set();
    const state = { id, name, executionType: 'continuous', triggerIntervalMs: 500 };

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

function createCollectionStub(graphs) {
    const listeners = new Set();
    let activeGraphIdx = 0;

    return {
        getId: () => 'collection-1',
        getTitle: () => 'Deletion Collection',
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

describe('CollectionView graph deletion', () => {
    let dom;
    let container;
    let removeGraphCalls;
    let viewManager;

    const i18nStub = {
        t: (key, params) => {
            if (!params) {
                return key;
            }
            return Object.entries(params).reduce(
                (text, [name, value]) => text.replace(`{{${name}}}`, value),
                key
            );
        },
        addEventListener: () => {},
        removeEventListener: () => {},
    };

    function createView(graphs) {
        const collection = createCollectionStub(graphs);
        const workspace = {
            collectionManager: {
                removeGraph: (...args) => {
                    removeGraphCalls.push(args);
                    return true;
                },
            },
            getActiveCollection: () => collection,
            config: {},
        };

        const view = new CollectionView({
            collection,
            workspace,
            viewManager,
            i18nService: i18nStub,
            logger: { log: () => {} },
        });

        return { view, collection };
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

        removeGraphCalls = [];
        viewManager = { showModal: () => {}, showConfirmation: async () => true };
    });

    afterEach(() => {
        dom.window.close();
        global.window = undefined;
        global.document = undefined;
    });

    it('renders graph tabs without a close button', () => {
        const { view } = createView([createGraphStub('graph-1', 'Graph 1')]);

        view.attachTo(container);

        const tabs = [...container.querySelectorAll('.tabbed-view__tab')].filter(
            (tab) => !tab.classList.contains('tabbed-view__tab--control')
        );
        assert.ok(tabs.length > 0, 'Expected at least one graph tab');
        assert.equal(container.querySelectorAll('.tabbed-view__tab-close').length, 0);

        view.detach();
    });

    it('reports whether the active graph may be deleted', () => {
        const single = createView([createGraphStub('graph-1', 'Graph 1')]);
        single.view.attachTo(container);
        assert.equal(single.view.canDeleteActiveGraph(), false);
        single.view.detach();

        const pair = createView([
            createGraphStub('graph-1', 'Graph 1'),
            createGraphStub('graph-2', 'Graph 2'),
        ]);
        pair.view.attachTo(container);
        assert.equal(pair.view.canDeleteActiveGraph(), true);
        pair.view.detach();
    });

    it('does nothing when only one graph remains', async () => {
        const { view } = createView([createGraphStub('graph-1', 'Graph 1')]);
        view.attachTo(container);

        await view.requestGraphDeletion();

        assert.deepEqual(removeGraphCalls, []);
        view.detach();
    });

    it('routes a confirmed deletion through the collection manager', async () => {
        viewManager.showModal = (dialog) => setTimeout(() => dialog.confirm(), 0);
        const { view } = createView([
            createGraphStub('graph-1', 'Graph 1'),
            createGraphStub('graph-2', 'Graph 2'),
        ]);
        view.attachTo(container);

        await view.requestGraphDeletion('graph-2');

        assert.equal(removeGraphCalls.length, 1);
        assert.equal(removeGraphCalls[0][0], 'collection-1');
        assert.equal(removeGraphCalls[0][1], 'graph-2');
        assert.equal(removeGraphCalls[0][2].replacementBaseName, 'Graph');

        view.detach();
    });

    it('skips the removal when the confirmation is cancelled', async () => {
        viewManager.showModal = (dialog) => setTimeout(() => dialog.cancel(), 0);
        const { view } = createView([
            createGraphStub('graph-1', 'Graph 1'),
            createGraphStub('graph-2', 'Graph 2'),
        ]);
        view.attachTo(container);

        await view.requestGraphDeletion('graph-1');

        assert.deepEqual(removeGraphCalls, []);
        view.detach();
    });

    it('drops the tab and republishes the active graph on graphRemoved', () => {
        const graphs = [
            createGraphStub('graph-1', 'Graph 1'),
            createGraphStub('graph-2', 'Graph 2'),
        ];
        const { view, collection } = createView(graphs);
        view.attachTo(container);

        const selectionCalls = [];
        const originalSetActiveGraphIdx = collection.setActiveGraphIdx;
        collection.setActiveGraphIdx = (idx) => {
            selectionCalls.push(idx);
            originalSetActiveGraphIdx(idx);
        };

        // Data-first removal: the model drops the graph, then the event arrives.
        collection.removeGraph('graph-2');
        collection.emit(
            new AppEvent(
                'graphRemoved',
                new MockPayload('Collection.GraphRemoved.v1', {
                    collectionId: 'collection-1',
                    graphId: 'graph-2',
                })
            )
        );

        const tabIds = view.views.map((entry) => entry.id);
        assert.deepEqual(tabIds, ['graph-1']);
        assert.ok(selectionCalls.length > 0, 'Expected the active graph to be republished');
        assert.equal(view.activeId, 'graph-1');

        view.detach();
    });

    it('selects a graph tab instead of a pinned special tab after removing the active graph', () => {
        const graphs = [
            createGraphStub('graph-1', 'Graph 1'),
            createGraphStub('graph-2', 'Graph 2'),
        ];
        const { view, collection } = createView(graphs);
        view.attachTo(container);
        view.selectView('graph-2');
        view.addView(
            { id: 'special', title: 'Special', placeholder: true },
            view.views.length,
            false,
            false,
            false
        );

        collection.removeGraph('graph-2');
        collection.setActiveGraphIdx(0);
        collection.emit(
            new AppEvent(
                'graphRemoved',
                new MockPayload('Collection.GraphRemoved.v1', {
                    collectionId: 'collection-1',
                    graphId: 'graph-2',
                })
            )
        );

        assert.equal(view.activeId, 'graph-1');
        assert.notEqual(view.activeId, 'special');
        assert.equal(collection.getActiveGraphIdx(), 0);
        assert.equal(
            container.querySelectorAll('.tabbed-view__view-container').length,
            1,
            'Expected the removed graph wrapper to be dropped'
        );

        view.detach();
    });
});
