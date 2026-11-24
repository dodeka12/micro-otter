// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file CollectionView graph-tab reordering and persistence.
 *
 * A user drag emits `TabbedView.TabMoved.v1`, CollectionView forwards it to
 * `CollectionManager.moveGraph()`, and `Collection.GraphMoved.v1` mirrors external
 * order changes back into the tab strip without a feedback loop.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

function createCollectionStub(graphs, initialActiveIdx = 0) {
    const listeners = new Set();
    const state = { activeGraphIdx: initialActiveIdx };

    const emit = (name, payload) => {
        const event = new AppEvent(name, payload);
        listeners.forEach((listener) => listener(event));
    };
    const indexOf = (graphId) => graphs.findIndex((graph) => graph.getId() === graphId);

    return {
        getId: () => 'collection-1',
        getTitle: () => 'Reorder Collection',
        getTargetId: () => null,
        getDeviceRuntimeId: () => 'general',
        getHistoryManager: () => null,
        getGraphArray: () => graphs.slice(),
        getGraphById: (id) => graphs.find((graph) => graph.getId() === id) || null,
        getActiveGraph: () => graphs[state.activeGraphIdx] || null,
        getActiveGraphIdx: () => state.activeGraphIdx,
        setActiveGraphIdx: (idx) => {
            state.activeGraphIdx = idx;
            emit(
                'activeGraphIdx',
                new MockPayload('Collection.ActiveGraphIndexChanged.v1', {
                    collectionId: 'collection-1',
                    activeGraphIdx: idx,
                })
            );
        },
        addGraph: (graph) => {
            graphs.push(graph);
            emit(
                'graphAdded',
                new MockPayload('Collection.GraphAdded.v1', {
                    collectionId: 'collection-1',
                    graph,
                })
            );
        },
        removeGraph: (graphId) => {
            const index = indexOf(graphId);
            if (index < 0) {
                return false;
            }
            graphs.splice(index, 1);
            if (state.activeGraphIdx === index) {
                state.activeGraphIdx = index > 0 ? index - 1 : 0;
            } else if (state.activeGraphIdx > index) {
                state.activeGraphIdx--;
            }
            emit(
                'graphRemoved',
                new MockPayload('Collection.GraphRemoved.v1', {
                    collectionId: 'collection-1',
                    graphId,
                })
            );
            return true;
        },
        moveGraph: (graphId, toIndex) => {
            const fromIndex = indexOf(graphId);
            if (fromIndex < 0 || graphs.length < 2 || !Number.isInteger(toIndex)) {
                return false;
            }
            const target = Math.min(Math.max(0, toIndex), graphs.length - 1);
            if (target === fromIndex) {
                return false;
            }

            const activeId = graphs[state.activeGraphIdx]?.getId() ?? null;
            const [moved] = graphs.splice(fromIndex, 1);
            graphs.splice(target, 0, moved);
            const nextActive = activeId
                ? graphs.findIndex((graph) => graph.getId() === activeId)
                : Math.min(state.activeGraphIdx, graphs.length - 1);
            const activeChanged = nextActive !== state.activeGraphIdx;
            state.activeGraphIdx = nextActive;

            emit(
                'graphMoved',
                new MockPayload('Collection.GraphMoved.v1', {
                    collectionId: 'collection-1',
                    graphId,
                    fromIndex,
                    toIndex: target,
                })
            );
            if (activeChanged) {
                emit(
                    'activeGraphIdx',
                    new MockPayload('Collection.ActiveGraphIndexChanged.v1', {
                        collectionId: 'collection-1',
                        activeGraphIdx: nextActive,
                    })
                );
            }
            return true;
        },
        getUniqueGraphName: () => 'Graph 1',
        getUniqueGraphId: () => 'graph-1',
        on: (_eventName, listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        emit: (name, payload) => emit(name, payload),
    };
}

describe('CollectionView tab reordering', () => {
    let dom;
    let container;
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

    function createView(graphs, options = {}) {
        const collection = createCollectionStub(graphs, options.activeGraphIdx ?? 0);
        const moveGraphCalls = [];
        const removeGraphCalls = [];

        const defaultManager = {
            removeGraph: (collectionId, graphId, removeOptions) => {
                removeGraphCalls.push([collectionId, graphId, removeOptions]);
                if (collection.getGraphArray().length <= 1) {
                    collection.addGraph(createGraphStub('graph-replacement', 'Graph 1'));
                }
                return collection.removeGraph(graphId);
            },
            moveGraph: (collectionId, graphId, toIndex) => {
                moveGraphCalls.push([collectionId, graphId, toIndex]);
                return collection.moveGraph(graphId, toIndex);
            },
        };

        const workspace = {
            collectionManager:
                options.manager === undefined ? defaultManager : options.manager,
            getActiveCollection: () => collection,
            config: {},
        };

        const viewOptions = {
            collection,
            workspace,
            viewManager,
            i18nService: i18nStub,
            logger: { log: () => {} },
        };
        if (options.reorderable !== undefined) {
            viewOptions.reorderable = options.reorderable;
        }

        const view = new CollectionView(viewOptions);

        return { view, collection, workspace, moveGraphCalls, removeGraphCalls };
    }

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.Element = dom.window.Element;
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

        viewManager = { showModal: () => {}, showConfirmation: async () => true };
    });

    afterEach(() => {
        dom.window.close();
        global.window = undefined;
        global.document = undefined;
    });


    it('is reorderable by default and serializes the flag', () => {
        const { view } = createView([
            createGraphStub('g0', 'G0'),
            createGraphStub('g1', 'G1'),
        ]);

        assert.equal(view.reorderable, true);
        assert.equal(view.serialize().reorderable, true);
    });

    it('honours reorderable: false but still allows programmatic sync', () => {
        const { view, moveGraphCalls } = createView(
            [createGraphStub('g0', 'G0'), createGraphStub('g1', 'G1'), createGraphStub('g2', 'G2')],
            { reorderable: false }
        );

        assert.equal(view.reorderable, false);
        assert.equal(view.serialize().reorderable, false);
        assert.equal(view.moveView('g0', 2), true);
        assert.equal(moveGraphCalls.length, 1);
    });

    it('deserializes legacy layouts as reorderable and explicit false as pinned', () => {
        const collection = createCollectionStub([createGraphStub('g0', 'G0')]);
        const workspace = {
            collectionManager: { removeGraph: () => true, moveGraph: () => true },
            getActiveCollection: () => collection,
            config: {},
        };
        const context = { workspace, collection, viewManager, i18nService: i18nStub };

        const legacy = CollectionView.deserialize(
            { collectionId: 'collection-1' },
            (entry) => entry,
            context
        );
        assert.equal(legacy.reorderable, true);

        const pinned = CollectionView.deserialize(
            { collectionId: 'collection-1', reorderable: false },
            (entry) => entry,
            context
        );
        assert.equal(pinned.reorderable, false);
    });

    it('keeps the new detail interfaces internal', () => {
        const source = readFileSync(
            new URL(
                '../../src/micro_otter/nodes/html/js/views/collection-view.ts',
                import.meta.url
            ),
            'utf8'
        );

        assert.doesNotMatch(source, /export interface TabMovedDetail/);
        assert.doesNotMatch(source, /export interface CollectionGraphMovedDetail/);
    });

    it('forwards a user tab move to CollectionManager.moveGraph exactly once', () => {
        const { view, moveGraphCalls } = createView([
            createGraphStub('g0', 'G0'),
            createGraphStub('g1', 'G1'),
            createGraphStub('g2', 'G2'),
        ]);

        assert.equal(view.moveView('g0', 2), true);

        assert.deepEqual(moveGraphCalls, [['collection-1', 'g0', 2]]);
    });

    it('does not forward no-op or unknown-tab moves', () => {
        const { view, moveGraphCalls } = createView([
            createGraphStub('g0', 'G0'),
            createGraphStub('g1', 'G1'),
        ]);

        assert.equal(view.moveView('g0', 0), false);
        assert.equal(view.moveView('missing', 1), false);

        assert.deepEqual(moveGraphCalls, []);
    });

    it('never forwards a pinned special tab', () => {
        const { view, moveGraphCalls } = createView([
            createGraphStub('g0', 'G0'),
            createGraphStub('g1', 'G1'),
        ]);
        view.addView(
            { id: 'special', title: 'Special', placeholder: true },
            view.views.length,
            false,
            false,
            false
        );

        assert.equal(view.moveView('special', 0), false);

        assert.deepEqual(moveGraphCalls, []);
    });

    it('rejects a target slot that is not a graph tab', () => {
        const { view, moveGraphCalls } = createView([
            createGraphStub('g0', 'G0'),
            createGraphStub('g1', 'G1'),
            createGraphStub('g2', 'G2'),
        ]);
        view.addView({ id: 'special', title: 'Special', placeholder: true }, 2, false, false, false);
        const tabMoved = [];
        view.on('tab-moved', (event) => tabMoved.push(event));

        view._onTabMoved(
            new AppEvent(
                'tab-moved',
                new MockPayload('TabbedView.TabMoved.v1', {
                    viewId: 'g0',
                    fromIndex: 0,
                    toIndex: 2,
                    view: view.views[0],
                })
            )
        );

        assert.deepEqual(moveGraphCalls, []);
        assert.equal(tabMoved.length, 0);
    });

    it('rejects out-of-range target indices defensively', () => {
        const { view, moveGraphCalls } = createView([
            createGraphStub('g0', 'G0'),
            createGraphStub('g1', 'G1'),
        ]);

        for (const toIndex of [-1, 2, 99]) {
            view._onTabMoved(
                new AppEvent(
                    'tab-moved',
                    new MockPayload('TabbedView.TabMoved.v1', {
                        viewId: 'g0',
                        fromIndex: 0,
                        toIndex,
                        view: view.views[0],
                    })
                )
            );
        }

        assert.deepEqual(moveGraphCalls, []);
    });

    it('does not throw when the collection manager is missing or lacks moveGraph', () => {
        const noManager = createView([createGraphStub('g0', 'G0'), createGraphStub('g1', 'G1')], {
            manager: null,
        });
        assert.doesNotThrow(() => noManager.view.moveView('g0', 1));
        assert.deepEqual(noManager.moveGraphCalls, []);

        const partialManager = createView(
            [createGraphStub('g0', 'G0'), createGraphStub('g1', 'G1')],
            { manager: { removeGraph: () => true } }
        );
        assert.doesNotThrow(() => partialManager.view.moveView('g0', 1));
        assert.deepEqual(partialManager.moveGraphCalls, []);
    });

    it('tolerates a manager move that returns false', () => {
        let calls = 0;
        const { view } = createView(
            [createGraphStub('g0', 'G0'), createGraphStub('g1', 'G1')],
            {
                manager: {
                    moveGraph: () => {
                        calls += 1;
                        return false;
                    },
                },
            }
        );
        let tabMoved = 0;
        view.on('tab-moved', () => {
            tabMoved += 1;
        });

        assert.doesNotThrow(() => view.moveView('g0', 1));
        assert.equal(calls, 1);
        assert.equal(tabMoved, 1);
    });

    it('throws on a malformed tab-moved payload', () => {
        const { view } = createView([createGraphStub('g0', 'G0'), createGraphStub('g1', 'G1')]);

        assert.throws(
            () =>
                view._onTabMoved(
                    new AppEvent(
                        'tab-moved',
                        new MockPayload('TabbedView.TabMoved.v1', {
                            viewId: 'g0',
                            fromIndex: 0,
                        })
                    )
                ),
            /missing required detail field 'toIndex'/
        );
    });

    it('mirrors external graphMoved events without calling the manager', () => {
        const { view, collection, moveGraphCalls } = createView([
            createGraphStub('g0', 'G0'),
            createGraphStub('g1', 'G1'),
            createGraphStub('g2', 'G2'),
        ]);
        const tabMoved = [];
        view.on('tab-moved', (event) => tabMoved.push(event));

        assert.equal(collection.moveGraph('g0', 2), true);

        assert.deepEqual(
            view.views.map((entry) => entry.id),
            ['g1', 'g2', 'g0']
        );
        assert.equal(tabMoved.length, 1);
        assert.deepEqual(moveGraphCalls, []);
    });

    it('ignores graphMoved when the tab is already at the target index', () => {
        const { view, collection } = createView([
            createGraphStub('g0', 'G0'),
            createGraphStub('g1', 'G1'),
            createGraphStub('g2', 'G2'),
        ]);
        const tabMoved = [];
        view.on('tab-moved', (event) => tabMoved.push(event));

        collection.emit(
            'graphMoved',
            new MockPayload('Collection.GraphMoved.v1', {
                collectionId: 'collection-1',
                graphId: 'g0',
                fromIndex: 2,
                toIndex: 0,
            })
        );

        assert.deepEqual(
            view.views.map((entry) => entry.id),
            ['g0', 'g1', 'g2']
        );
        assert.equal(tabMoved.length, 0);
    });

    it('leaves the order untouched for a graphMoved id that is not a tab', () => {
        const { view, collection } = createView([
            createGraphStub('g0', 'G0'),
            createGraphStub('g1', 'G1'),
        ]);

        collection.emit(
            'graphMoved',
            new MockPayload('Collection.GraphMoved.v1', {
                collectionId: 'collection-1',
                graphId: 'ghost',
                fromIndex: 0,
                toIndex: 1,
            })
        );

        assert.deepEqual(
            view.views.map((entry) => entry.id),
            ['g0', 'g1']
        );
    });

    it('completes a user round-trip with one manager call and no recursion', () => {
        const { view, collection, moveGraphCalls } = createView([
            createGraphStub('g0', 'G0'),
            createGraphStub('g1', 'G1'),
            createGraphStub('g2', 'G2'),
        ]);
        const graphMoved = [];
        collection.on('*', (event) => {
            if (event.name === 'graphMoved') {
                graphMoved.push(event);
            }
        });

        assert.equal(view.moveView('g0', 2), true);

        assert.equal(moveGraphCalls.length, 1);
        assert.equal(graphMoved.length, 1);
        assert.deepEqual(
            view.views.map((entry) => entry.id),
            ['g1', 'g2', 'g0']
        );
        assert.deepEqual(
            collection.getGraphArray().map((graph) => graph.getId()),
            ['g1', 'g2', 'g0']
        );
    });

    it('keeps the active graph active across an external crossing move', () => {
        const { view, collection } = createView(
            [createGraphStub('g0', 'G0'), createGraphStub('g1', 'G1'), createGraphStub('g2', 'G2')],
            { activeGraphIdx: 1 }
        );
        const activeBefore = view.activeId;
        const activeGraph = collection.getActiveGraph().getId();

        assert.equal(collection.moveGraph('g0', 2), true);

        assert.equal(view.activeId, activeBefore);
        assert.equal(collection.getActiveGraph().getId(), activeGraph);
        assert.deepEqual(
            view.views.map((entry) => entry.id),
            ['g1', 'g2', 'g0']
        );
    });

    it('throws on a malformed graphMoved payload', () => {
        const { collection } = createView([createGraphStub('g0', 'G0'), createGraphStub('g1', 'G1')]);

        assert.throws(
            () =>
                collection.emit(
                    'graphMoved',
                    new MockPayload('Collection.GraphMoved.v1', {
                        collectionId: 'collection-1',
                        graphId: 'g0',
                        fromIndex: 0,
                    })
                ),
            /missing required detail field 'toIndex'/
        );
    });

    it('ignores a re-entrant graphMoved while syncing', () => {
        const { view, collection } = createView([
            createGraphStub('g0', 'G0'),
            createGraphStub('g1', 'G1'),
            createGraphStub('g2', 'G2'),
        ]);
        const tabMoved = [];
        view.on('tab-moved', (event) => tabMoved.push(event));
        view._syncingGraphOrder = true;

        collection.emit(
            'graphMoved',
            new MockPayload('Collection.GraphMoved.v1', {
                collectionId: 'collection-1',
                graphId: 'g0',
                fromIndex: 0,
                toIndex: 2,
            })
        );

        assert.deepEqual(
            view.views.map((entry) => entry.id),
            ['g0', 'g1', 'g2']
        );
        assert.equal(tabMoved.length, 0);
        view._syncingGraphOrder = false;
    });

    it('inserts new graphs before the first pinned special tab', () => {
        const { view, collection } = createView([
            createGraphStub('g0', 'G0'),
            createGraphStub('g1', 'G1'),
        ]);
        view.addView(
            { id: 'special', title: 'Special', placeholder: true },
            view.views.length,
            false,
            false,
            false
        );

        collection.addGraph(createGraphStub('g2', 'G2'));

        assert.deepEqual(
            view.views.map((entry) => entry.id),
            ['g0', 'g1', 'g2', 'special']
        );
    });

    it('keeps the graph block leading when several graphs are added', () => {
        const { view, collection } = createView([createGraphStub('g0', 'G0')]);
        view.addView(
            { id: 'special', title: 'Special', placeholder: true },
            view.views.length,
            false,
            false,
            false
        );

        collection.addGraph(createGraphStub('g1', 'G1'));
        collection.addGraph(createGraphStub('g2', 'G2'));

        assert.deepEqual(
            view.views.map((entry) => entry.id),
            ['g0', 'g1', 'g2', 'special']
        );
    });

    it('appends graphs during initial load when there are no specials', () => {
        const { view } = createView([
            createGraphStub('g0', 'G0'),
            createGraphStub('g1', 'G1'),
            createGraphStub('g2', 'G2'),
        ]);

        assert.deepEqual(
            view.views.map((entry) => entry.id),
            ['g0', 'g1', 'g2']
        );
    });

    it('selects a graph tab when removing the active graph next to a special tab', () => {
        const { view, collection } = createView(
            [createGraphStub('g0', 'G0'), createGraphStub('g1', 'G1'), createGraphStub('g2', 'G2')],
            { activeGraphIdx: 2 }
        );
        view.addView(
            { id: 'special', title: 'Special', placeholder: true },
            view.views.length,
            false,
            false,
            false
        );

        assert.equal(view.activeId, 'g2');
        assert.equal(collection.removeGraph('g2'), true);

        assert.equal(view.activeId, 'g1');
        assert.equal(collection.getActiveGraphIdx(), 1);
        assert.equal(collection.getActiveGraph().getId(), 'g1');
        assert.equal(view.activeId === 'special', false);
    });

    it('leaves the active tab unchanged when removing a non-active graph', () => {
        const { view, collection } = createView(
            [createGraphStub('g0', 'G0'), createGraphStub('g1', 'G1'), createGraphStub('g2', 'G2')],
            { activeGraphIdx: 1 }
        );

        assert.equal(collection.removeGraph('g0'), true);

        assert.equal(view.activeId, 'g1');
        assert.equal(collection.getActiveGraphIdx(), 0);
        assert.deepEqual(
            view.views.map((entry) => entry.id),
            ['g1', 'g2']
        );
    });

    it('creates a replacement graph inside the graph block', () => {
        const { view } = createView([createGraphStub('g0', 'G0')]);
        view.addView(
            { id: 'special', title: 'Special', placeholder: true },
            view.views.length,
            false,
            false,
            false
        );

        assert.equal(view._removeGraph('g0'), true);

        assert.deepEqual(
            view.views.map((entry) => entry.id),
            ['graph-replacement', 'special']
        );
    });

    it('appends placeholders at the end when reorderable is false', () => {
        const { view } = createView(
            [createGraphStub('g0', 'G0'), createGraphStub('g1', 'G1')],
            { reorderable: false }
        );

        view._createTabPlaceholder(createGraphStub('g2', 'G2'));

        assert.deepEqual(
            view.views.map((entry) => entry.id),
            ['g0', 'g1', 'g2']
        );
    });
});


