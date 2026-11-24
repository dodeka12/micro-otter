// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Interaction tests for documentation areas: gesture math, clamping, snapping, keys, history.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDomHarness } from '../helpers/dom-harness.js';
import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { HistoryManager } from '../../src/micro_otter/nodes/html/js/data/history-manager.js';
import { generateUuidV4 } from '../../src/micro_otter/nodes/html/js/data/uuid.js';
import { DOCUMENTATION_AREA_MIN_SIZE } from '../../src/micro_otter/nodes/html/js/data/documentation-area.js';
import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';

globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);

const I18N = {
    t: (key) => key,
    addEventListener: () => {},
    removeEventListener: () => {},
    getCurrentLanguage: () => 'en',
};

function createPanel({ gridEnabled = false } = {}) {
    const collection = new Collection({
        id: generateUuidV4(),
        title: 'Interaction',
        graphs: [{ id: 'graph-1', name: 'Graph 1', nodes: [], connections: [] }],
    });
    const graph = collection.getActiveGraph();
    const historyManager = new HistoryManager(collection);
    collection.getHistoryManager = () => historyManager;

    const view = new GraphPanelView({
        graph,
        collection,
        i18nService: I18N,
        logger: { log: () => {} },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    view.attachTo(container);
    view._isVisible = true;
    view.gridEnabled = gridEnabled;
    return { view, graph, historyManager, collection };
}

function fakeEvent(clientX = 0, clientY = 0) {
    return { button: 0, clientX, clientY, preventDefault() {}, stopPropagation() {} };
}

function keyEvent(key) {
    return { key, preventDefault() {} };
}

/**
 * Continue the active gesture by a world-space delta from its recorded start point.
 * @param {object} view - Panel under test.
 * @param {number} dx - Horizontal world delta.
 * @param {number} dy - Vertical world delta.
 */
function dragBy(view, dx, dy) {
    const start = view._documentationAreaDrag.startWorld;
    return view._handleDocumentationAreaPointerMove({ x: start.x + dx, y: start.y + dy });
}

describe('GraphPanelView documentation-area gestures', () => {
    let harness;
    let view;
    let graph;

    beforeEach(() => {
        harness = createDomHarness();
    });

    afterEach(() => {
        view?.dispose();
        view = null;
        harness.cleanup();
    });

    function setup(options) {
        ({ view, graph } = createPanel(options));
    }

    it('moves an area by the pointer delta without changing its size', () => {
        setup({ gridEnabled: false });
        const area = graph.addDocumentationArea({
            bounds: { x: 100, y: 100, width: 300, height: 200 },
        });

        view._handleDocumentationAreaMouseDown({ areaId: area.id, zone: 'header' }, fakeEvent());
        dragBy(view, 60, 40);

        assert.deepEqual(area.bounds, { x: 160, y: 140, width: 300, height: 200 });
        assert.equal(view.activeDocumentationAreaId, area.id);
    });

    it('resizes from the bottom-right corner and never drops below the minimum', () => {
        setup({ gridEnabled: false });
        const area = graph.addDocumentationArea({
            bounds: { x: 100, y: 100, width: 300, height: 200 },
        });

        view._handleDocumentationAreaMouseDown({ areaId: area.id, zone: 'resize' }, fakeEvent());
        dragBy(view, -500, -500);

        assert.equal(area.bounds.x, 100);
        assert.equal(area.bounds.y, 100);
        assert.equal(area.bounds.width, DOCUMENTATION_AREA_MIN_SIZE.width);
        assert.equal(area.bounds.height, DOCUMENTATION_AREA_MIN_SIZE.height);
    });

    it('snaps to grid multiples when snapping is enabled', () => {
        setup({ gridEnabled: true });
        const area = graph.addDocumentationArea({
            bounds: { x: 96, y: 96, width: 288, height: 192 },
        });
        const step = view.constants.GRID_SPACING;

        view._handleDocumentationAreaMouseDown({ areaId: area.id, zone: 'header' }, fakeEvent());
        dragBy(view, 5, -3);

        assert.equal(area.bounds.x % step, 0);
        assert.equal(area.bounds.y % step, 0);
        assert.equal(area.bounds.width, 288);
    });

    it('follows the pointer exactly when snapping is disabled', () => {
        setup({ gridEnabled: false });
        const area = graph.addDocumentationArea({
            bounds: { x: 96, y: 96, width: 288, height: 192 },
        });

        view._handleDocumentationAreaMouseDown({ areaId: area.id, zone: 'header' }, fakeEvent());
        dragBy(view, 5, -3);

        assert.equal(area.bounds.x, 101);
        assert.equal(area.bounds.y, 93);
    });

    it('keeps the area inside the graph bounds when dragged far away', () => {
        setup({ gridEnabled: false });
        const area = graph.addDocumentationArea({
            bounds: { x: 100, y: 100, width: 300, height: 200 },
        });

        view._handleDocumentationAreaMouseDown({ areaId: area.id, zone: 'header' }, fakeEvent());
        dragBy(view, -5000, -5000);

        assert.equal(area.bounds.x, 0);
        assert.equal(area.bounds.y, 0);
    });
});

describe('GraphPanelView documentation-area history and keys', () => {
    let harness;
    let view;
    let graph;
    let historyManager;

    beforeEach(() => {
        harness = createDomHarness();
    });

    afterEach(() => {
        view?.dispose();
        view = null;
        harness.cleanup();
    });

    function setup(options = { gridEnabled: false }) {
        ({ view, graph, historyManager } = createPanel(options));
    }

    it('records exactly one history operation for a whole gesture', () => {
        setup();
        const area = graph.addDocumentationArea({ title: 'Moved' });
        const depthBefore = historyManager.getHistoryDepth();

        view._handleDocumentationAreaMouseDown({ areaId: area.id, zone: 'header' }, fakeEvent());
        dragBy(view, 150, 150);
        dragBy(view, 250, 250);
        assert.equal(historyManager.getHistoryDepth(), depthBefore);
        assert.equal(view._handleDocumentationAreaPointerUp(), true);

        assert.equal(historyManager.getHistoryDepth(), depthBefore + 1);
        historyManager.undo();
        assert.deepEqual(area.bounds, { x: 0, y: 0, width: 320, height: 200 });
    });

    it('restores the start bounds and records nothing when Escape cancels', () => {
        setup();
        const area = graph.addDocumentationArea({
            bounds: { x: 100, y: 100, width: 300, height: 200 },
        });
        const depthBefore = historyManager.getHistoryDepth();

        view._handleDocumentationAreaMouseDown({ areaId: area.id, zone: 'header' }, fakeEvent());
        dragBy(view, 100, 100);
        assert.equal(view._handleDocumentationAreaKeyDown(keyEvent('Escape')), true);

        assert.deepEqual(area.bounds, { x: 100, y: 100, width: 300, height: 200 });
        assert.equal(historyManager.getHistoryDepth(), depthBefore);
    });

    it('deletes the active area through the history pre-hook', () => {
        setup();
        const area = graph.addDocumentationArea({ title: 'Delete me' });
        const order = [];
        const originalBefore = historyManager.beforeDocumentationAreaRemove.bind(historyManager);
        historyManager.beforeDocumentationAreaRemove = (areaId) => {
            order.push('before');
            originalBefore(areaId);
        };
        const originalRemove = graph.removeDocumentationArea.bind(graph);
        graph.removeDocumentationArea = (areaId) => {
            order.push('remove');
            return originalRemove(areaId);
        };

        view.setActiveDocumentationArea(area.id);
        assert.equal(view._handleDocumentationAreaKeyDown(keyEvent('Delete')), true);

        assert.deepEqual(order, ['before', 'remove']);
        assert.equal(graph.getDocumentationAreas().length, 0);
        assert.equal(view.activeDocumentationAreaId, null);

        historyManager.undo();
        const restored = graph.getDocumentationAreas();
        assert.equal(restored.length, 1);
        assert.equal(restored[0].id, area.id);
    });

    it('keeps node deletion winning over an active area', () => {
        setup();
        const node = graph.addNode({ type: 'test-node', x: 10, y: 10 });
        const area = graph.addDocumentationArea({ title: 'Bystander' });
        view.setActiveDocumentationArea(area.id);
        view.selection.selectedNodes.add(node.id);

        assert.equal(view._handleDocumentationAreaKeyDown(keyEvent('Delete')), false);
        assert.equal(graph.getDocumentationAreas().length, 1);
    });

    it('clears the active area on Escape when idle', () => {
        setup();
        const area = graph.addDocumentationArea({ title: 'Active' });
        view.setActiveDocumentationArea(area.id);

        assert.equal(view._handleDocumentationAreaKeyDown(keyEvent('Escape')), true);
        assert.equal(view.activeDocumentationAreaId, null);
    });

    it('declines every area key when nothing is active', () => {
        setup();

        assert.equal(view._handleDocumentationAreaKeyDown(keyEvent('Delete')), false);
        assert.equal(view._handleDocumentationAreaKeyDown(keyEvent('Escape')), false);
        assert.equal(view._handleDocumentationAreaKeyDown(keyEvent('F2')), false);
        assert.equal(view._handleDocumentationAreaPointerUp(), false);
    });
});
