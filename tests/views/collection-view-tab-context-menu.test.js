// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Graph-tab context menu wiring in CollectionView.
 *
 * TabbedView reports the tab and anchor; CollectionView adds graph-specific actions (rename, enable
 * toggle, delete) and routes them through the existing graph APIs.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { AppEvent, AppPayload } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import { CollectionView } from '../../src/micro_otter/nodes/html/js/views/collection-view.js';
import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';
import {
    clearGraphClipboard,
    getGraphClipboard,
    setGraphClipboard,
} from '../../src/micro_otter/nodes/html/js/core/graph-clipboard.js';

class MockPayload extends AppPayload {
    constructor(payloadTypeId, detail = {}) {
        super(payloadTypeId);
        Object.assign(this, detail);
    }
}

const localeRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/micro_otter/nodes/html/locales'
);

function readLocale(name) {
    return JSON.parse(fs.readFileSync(path.join(localeRoot, `${name}.json`), 'utf8'));
}

function createGraphStub(id, name, { enabled = true, toData = null } = {}) {
    const state = { id, name, executionType: 'continuous', triggerIntervalMs: 500, enabled };
    const listeners = new Set();

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
        getEnabled: () => state.enabled,
        setEnabled: (value) => {
            state.enabled = value;
            listeners.forEach((listener) =>
                listener({ name: 'enabled', detail: { enabled: value } })
            );
        },
        toData: toData ?? undefined,
        on: (_eventName, listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

function createCollectionStub(graphs, { uniqueId = 'graph-1', uniqueName = 'Graph 1' } = {}) {
    const listeners = new Set();
    let activeGraphIdx = 0;

    return {
        getId: () => 'collection-1',
        getTitle: () => 'Context Menu Collection',
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
            listeners.forEach((listener) =>
                listener(
                    new AppEvent(
                        'graphAdded',
                        new MockPayload('Collection.GraphAdded.v1', {
                            collectionId: 'collection-1',
                            graph,
                        })
                    )
                )
            );
        },
        removeGraph: (graphId) => {
            const index = graphs.findIndex((graph) => graph.getId() === graphId);
            if (index < 0) {
                return false;
            }
            graphs.splice(index, 1);
            return true;
        },
        getUniqueGraphName: () => uniqueName,
        getUniqueGraphId: () => uniqueId,
        on: (_eventName, listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        emit: (event) => listeners.forEach((listener) => listener(event)),
    };
}

describe('CollectionView graph tab context menu', () => {
    let dom;
    let container;
    let overlays;

    const i18nStub = {
        t: (key) => key,
        addEventListener: () => {},
        removeEventListener: () => {},
    };

    function createView(graphs, collectionOptions = {}) {
        const collection = createCollectionStub(graphs, collectionOptions);
        const viewManager = {
            showModal: () => {},
            addOverlay: (overlay) => {
                overlays.push(overlay);
                return overlay;
            },
        };
        const workspace = {
            collectionManager: { removeGraph: () => true },
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

        return { view, collection, viewManager };
    }

    function openGraphTwoMenu() {
        const tab = container.querySelector('.tabbed-view__tab[data-view-id="graph-2"]');
        assert.ok(tab, 'Expected a graph-2 tab');

        tab.dispatchEvent(
            new dom.window.MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: 40,
                clientY: 80,
            })
        );

        assert.equal(overlays.length, 1, 'Expected one context-menu overlay');
        return overlays[0];
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
        overlays = [];
    });

    afterEach(() => {
        clearGraphClipboard();
        dom.window.close();
        global.window = undefined;
        global.document = undefined;
    });

    it('opens a graph menu with rename, enable and delete entries', () => {
        const graphTwo = createGraphStub('graph-2', 'Graph 2', { enabled: true });
        const { view } = createView([createGraphStub('graph-1', 'Graph 1'), graphTwo]);
        view.attachTo(container);

        const menuWindow = openGraphTwoMenu();
        const menu = menuWindow.getMenu();
        const renameItem = menu.items.find((item) => item.id === 'rename-graph');
        const enabledItem = menu.items.find((item) => item.id === 'toggle-graph-enabled');
        const deleteItem = menu.items.find((item) => item.id === 'delete-graph');

        assert.ok(renameItem);
        assert.equal(renameItem.label, 'collection.tabContextMenu.rename');
        assert.ok(enabledItem);
        assert.equal(enabledItem.checked, true);
        assert.equal(enabledItem.label, 'collection.tabContextMenu.enabled');
        assert.ok(deleteItem);
        assert.equal(deleteItem.label, 'menu.item.deleteGraph');
        assert.equal(deleteItem.disabled, false);
        assert.equal(menu.title, 'Graph 2');

        view.detach();
    });

    it('starts an inline rename for the right-clicked tab', () => {
        const graphTwo = createGraphStub('graph-2', 'Graph 2');
        const { view } = createView([createGraphStub('graph-1', 'Graph 1'), graphTwo]);
        view.attachTo(container);

        const menu = openGraphTwoMenu().getMenu();
        menu.onSelectCallback({ id: 'rename-graph', label: 'Rename Graph' });

        const input = container.querySelector('.tabbed-view__tab-rename-input');
        assert.ok(input, 'Expected the tab label to become an input');
        assert.equal(input.value, 'Graph 2');
        assert.equal(view.activeId, 'graph-1', 'Renaming must not change the active tab');

        input.value = 'Renamed Graph';
        input.dispatchEvent(
            new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );

        assert.equal(graphTwo.getName(), 'Renamed Graph');
        assert.ok(
            container.querySelector('.tabbed-view__tab[data-view-id="graph-2"] .tabbed-view__tab-label')
                ?.textContent === 'Renamed Graph'
        );

        view.detach();
    });

    it('keeps double-click as an inline rename entry point', () => {
        const { view } = createView([
            createGraphStub('graph-1', 'Graph 1'),
            createGraphStub('graph-2', 'Graph 2'),
        ]);
        view.attachTo(container);

        const label = container.querySelector(
            '.tabbed-view__tab[data-view-id="graph-2"] .tabbed-view__tab-label'
        );
        label.dispatchEvent(
            new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true })
        );

        assert.ok(container.querySelector('.tabbed-view__tab-rename-input'));

        view.detach();
    });

    it('reflects a disabled graph and blocks delete when it is the only graph', () => {
        const single = createGraphStub('graph-1', 'Graph 1', { enabled: false });
        const { view } = createView([single]);

        const items = view._buildGraphTabContextMenuItems(single);
        const enabledItem = items.find((item) => item.id === 'toggle-graph-enabled');
        const deleteItem = items.find((item) => item.id === 'delete-graph');

        assert.equal(enabledItem.checked, false);
        assert.equal(deleteItem.disabled, true);
    });

    it('offers copy and paste, with paste disabled while the slot is empty', () => {
        const graph = createGraphStub('graph-1', 'Graph 1');
        const { view } = createView([graph]);

        const beforeCopy = view._buildGraphTabContextMenuItems(graph);
        const copyItem = beforeCopy.find((item) => item.id === 'copy-graph');
        const pasteBefore = beforeCopy.find((item) => item.id === 'paste-graph');

        assert.equal(copyItem.label, 'collection.tabContextMenu.copy');
        assert.equal(copyItem.icon, IconProvider.contentCopy);
        assert.equal(copyItem.disabled, undefined);
        assert.equal(pasteBefore.label, 'collection.tabContextMenu.paste');
        assert.equal(pasteBefore.icon, IconProvider.contentPaste);
        assert.equal(pasteBefore.disabled, true);

        setGraphClipboard({
            data: { id: 'graph-1', name: 'Graph 1', nodes: [], connections: [] },
            sourceCollectionId: 'collection-1',
        });

        const afterCopy = view._buildGraphTabContextMenuItems(graph);
        assert.equal(afterCopy.find((item) => item.id === 'paste-graph').disabled, false);
    });

    it('copies the right-clicked graph into the graph clipboard', () => {
        const data = {
            id: 'graph-2',
            name: 'Graph 2',
            executionType: 'continuous',
            nodes: [{ id: '1', type: 'console' }],
            connections: [],
            documentationAreas: [],
            viewportConfig: { translateX: 10, translateY: 20, scale: 1 },
        };
        const { view } = createView([
            createGraphStub('graph-1', 'Graph 1'),
            createGraphStub('graph-2', 'Graph 2', { toData: () => data }),
        ]);
        view.attachTo(container);

        const menu = openGraphTwoMenu().getMenu();
        menu.onSelectCallback({ id: 'copy-graph', label: 'Copy Graph' });

        const payload = getGraphClipboard();
        assert.equal(payload.data.id, 'graph-2');
        assert.equal(payload.data.name, 'Graph 2');
        assert.equal(payload.sourceCollectionId, 'collection-1');
        assert.equal(payload.data.nodes.length, 1);

        view.detach();
    });

    it('pastes the copied graph as a new graph and activates it', () => {
        const data = {
            id: 'graph-2',
            name: 'Graph 2',
            executionType: 'continuous',
            triggerIntervalMs: 250,
            nodes: [
                { id: '1', type: 'console', inputs: [], outputs: [{ id: 'out0' }] },
                { id: '2', type: 'emit', inputs: [{ id: 'in0' }], outputs: [] },
            ],
            connections: [{ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 }],
            documentationAreas: [],
            viewportConfig: { translateX: 40, translateY: 40, scale: 2 },
        };
        const { view, collection } = createView(
            [
                createGraphStub('graph-1', 'Graph 1'),
                createGraphStub('graph-2', 'Graph 2', { toData: () => data }),
            ],
            { uniqueId: 'graph-9', uniqueName: 'Graph 2 1' }
        );
        view.attachTo(container);

        const menu = openGraphTwoMenu().getMenu();
        menu.onSelectCallback({ id: 'copy-graph', label: 'Copy Graph' });
        const graphCountBefore = collection.getGraphArray().length;

        menu.onSelectCallback({ id: 'paste-graph', label: 'Paste Graph' });

        const graphs = collection.getGraphArray();
        assert.equal(graphs.length, graphCountBefore + 1, 'exactly one graph is pasted');
        const pasted = graphs[graphs.length - 1];
        assert.equal(pasted.getId(), 'graph-9');
        assert.equal(pasted.getName(), 'Graph 2 1');
        assert.equal(pasted.getNodes().length, 2);
        assert.equal(pasted.getConnections().length, 1);
        assert.equal(pasted.getTriggerInterval(), 250);
        assert.equal(view.activeId, 'graph-9');

        view.detach();
    });

    it('keeps call nodes whose function graph is missing from the target collection', () => {
        const data = {
            id: 'graph-2',
            name: 'Graph 2',
            executionType: 'continuous',
            nodes: [
                { id: '1', type: 'function_graph.gone', inputs: [{ id: 'in_0' }], outputs: [] },
            ],
            connections: [],
            documentationAreas: [],
            viewportConfig: { translateX: 0, translateY: 0, scale: 1 },
        };
        const { view, collection } = createView(
            [
                createGraphStub('graph-1', 'Graph 1'),
                createGraphStub('graph-2', 'Graph 2', { toData: () => data }),
            ],
            { uniqueId: 'graph-9', uniqueName: 'Graph 2 1' }
        );
        view.attachTo(container);

        const menu = openGraphTwoMenu().getMenu();
        menu.onSelectCallback({ id: 'copy-graph', label: 'Copy Graph' });
        menu.onSelectCallback({ id: 'paste-graph', label: 'Paste Graph' });

        const graphs = collection.getGraphArray();
        const pasted = graphs[graphs.length - 1];
        assert.equal(pasted.getNodes().length, 1, 'the call node is kept, not deleted');
        assert.equal(pasted.getNodes()[0].getType(), 'function_graph.gone');

        view.detach();
    });

    it('toggles the graph enabled flag from the menu', () => {
        const graphTwo = createGraphStub('graph-2', 'Graph 2', { enabled: true });
        const { view } = createView([createGraphStub('graph-1', 'Graph 1'), graphTwo]);
        view.attachTo(container);

        const menu = openGraphTwoMenu().getMenu();

        menu.onSelectCallback({ id: 'toggle-graph-enabled', label: 'Enabled' });
        assert.equal(graphTwo.getEnabled(), false);

        menu.onSelectCallback({ id: 'toggle-graph-enabled', label: 'Enabled' });
        assert.equal(graphTwo.getEnabled(), true);

        view.detach();
    });

    it('repaints the active canvas when the menu disables the graph', () => {
        const graphOne = createGraphStub('graph-1', 'Graph 1', { enabled: true });
        const { view } = createView([graphOne, createGraphStub('graph-2', 'Graph 2')]);
        view.attachTo(container);

        const tab = container.querySelector('.tabbed-view__tab[data-view-id="graph-1"]');
        tab.dispatchEvent(
            new dom.window.MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: 10,
                clientY: 20,
            })
        );

        const menu = overlays[0].getMenu();
        menu.onSelectCallback({ id: 'toggle-graph-enabled', label: 'Enabled' });

        assert.equal(graphOne.getEnabled(), false);
        assert.ok(
            container
                .querySelector('.graph-panel-view__canvas')
                .classList.contains('graph-panel-view__canvas--disabled')
        );

        view.detach();
    });

    it('routes delete through requestGraphDeletion for the right-clicked graph', async () => {
        const { view } = createView([
            createGraphStub('graph-1', 'Graph 1'),
            createGraphStub('graph-2', 'Graph 2'),
        ]);
        view.attachTo(container);

        const menu = openGraphTwoMenu().getMenu();
        let requestedGraphId = null;
        view.requestGraphDeletion = async (graphId) => {
            requestedGraphId = graphId;
        };

        menu.onSelectCallback({ id: 'delete-graph', label: 'Delete Graph' });
        await Promise.resolve();

        assert.equal(requestedGraphId, 'graph-2');
        assert.equal(view.activeId, 'graph-1', 'Opening the menu must not change the active tab');

        view.detach();
    });

    it('defines the graph context-menu labels in both locales', () => {
        for (const locale of ['en', 'de']) {
            const tabContextMenu = readLocale(locale).collection?.tabContextMenu || {};
            const deleteGraph = readLocale(locale).menu?.item?.deleteGraph;

            assert.equal(typeof tabContextMenu.rename, 'string', `${locale} rename label`);
            assert.ok(tabContextMenu.rename.length > 0, `${locale} rename label is not empty`);
            assert.equal(typeof tabContextMenu.enabled, 'string', `${locale} enabled label`);
            assert.ok(tabContextMenu.enabled.length > 0, `${locale} enabled label is not empty`);
            assert.equal(typeof deleteGraph, 'string', `${locale} deleteGraph label`);
            assert.ok(deleteGraph.length > 0, `${locale} deleteGraph label is not empty`);
        }
    });
});
