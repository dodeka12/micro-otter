// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Panel actions for documentation areas: menu, colour picker, duplicate, fit to selection.
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
    t: (key) => {
        if (key === 'documentationArea.duplicateTitle') {
            return '{title} copy';
        }
        if (key === 'documentationArea.untitled') {
            return 'Untitled area';
        }
        return key;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    getCurrentLanguage: () => 'en',
};

function createPanel() {
    const collection = new Collection({
        id: generateUuidV4(),
        title: 'Area actions',
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
    return { view, graph, historyManager, collection };
}

function colorInput() {
    return document.body.querySelector('input[type="color"]');
}

describe('GraphPanelView documentation-area actions', () => {
    let harness;
    let view;
    let graph;
    let historyManager;

    beforeEach(() => {
        harness = createDomHarness();
        ({ view, graph, historyManager } = createPanel());
    });

    afterEach(() => {
        view?.dispose();
        view = null;
        harness.cleanup();
    });

    it('opens exactly one menu and clears the reference on close', () => {
        const area = graph.addDocumentationArea({ title: 'Menu' });

        view._showDocumentationAreaMenu(area.id, document.createElement('div').getBoundingClientRect());

        assert.ok(view._activeContextMenu, 'expected an overlay window');
        const menuWindow = view._activeContextMenu;
        assert.equal(view.activeDocumentationAreaId, area.id);

        menuWindow.close();

        assert.equal(view._activeContextMenu, null);
    });

    it('previews a picked colour without touching the graph or history', () => {
        const area = graph.addDocumentationArea({ color: '#4a90d9' });
        const previews = [];
        view.documentationLayer.previewAreaColor = (areaId, hex) => previews.push({ areaId, hex });
        const depthBefore = historyManager.getHistoryDepth();

        view._showDocumentationAreaColorPicker(area.id);
        const input = colorInput();
        assert.ok(input, 'expected a native colour input');

        input.value = '#ff0000';
        input.dispatchEvent(new harness.window.Event('input'));

        assert.deepEqual(previews, [{ areaId: area.id, hex: '#ff0000' }]);
        assert.equal(area.color, '#4a90d9');
        assert.equal(historyManager.getHistoryDepth(), depthBefore);

        input.remove();
    });

    it('commits a picked colour as one history step and stores #rrggbb', () => {
        const area = graph.addDocumentationArea({ color: '#4a90d9' });
        const cleared = [];
        view.documentationLayer.clearAreaColorPreview = (areaId) => cleared.push(areaId);
        const depthBefore = historyManager.getHistoryDepth();

        view._showDocumentationAreaColorPicker(area.id);
        const input = colorInput();
        input.value = '#00FF00';
        input.dispatchEvent(new harness.window.Event('change'));

        assert.equal(area.color, '#00ff00');
        assert.equal(historyManager.getHistoryDepth(), depthBefore + 1);
        assert.deepEqual(cleared, [area.id]);

        historyManager.undo();
        assert.equal(area.color, '#4a90d9');
    });

    it('restores the stored colour when the picker is cancelled', () => {
        const area = graph.addDocumentationArea({ color: '#123456' });
        const cleared = [];
        view.documentationLayer.clearAreaColorPreview = (areaId) => cleared.push(areaId);
        const depthBefore = historyManager.getHistoryDepth();

        view._showDocumentationAreaColorPicker(area.id);
        const input = colorInput();
        input.dispatchEvent(new harness.window.Event('blur'));

        assert.deepEqual(cleared, [area.id]);
        assert.equal(area.color, '#123456');
        assert.equal(historyManager.getHistoryDepth(), depthBefore);

        input.remove();
    });

    it('changes the font-size preset as one history step', () => {
        const area = graph.addDocumentationArea({ fontSize: 'normal' });
        const depthBefore = historyManager.getHistoryDepth();

        assert.equal(view._setDocumentationAreaFontSize(area.id, 'large'), true);
        assert.equal(area.fontSize, 'large');
        assert.equal(historyManager.getHistoryDepth(), depthBefore + 1);

        historyManager.undo();
        assert.equal(area.fontSize, 'normal');

        assert.equal(view._setDocumentationAreaFontSize('missing', 'small'), false);
    });

    it('duplicates an area with an offset and a fresh id', () => {
        const area = graph.addDocumentationArea({
            title: 'Original',
            markdown: '**body**',
            color: '#abcdef',
            fontSize: 'small',
            bounds: { x: 100, y: 100, width: 300, height: 200 },
        });
        const depthBefore = historyManager.getHistoryDepth();

        assert.equal(view._duplicateDocumentationArea(area.id), true);

        const areas = graph.getDocumentationAreas();
        assert.equal(areas.length, 2);
        assert.notEqual(areas[1].id, area.id);
        assert.equal(areas[1].title, 'Original copy');
        assert.equal(areas[1].markdown, '**body**');
        assert.equal(areas[1].color, '#abcdef');
        assert.equal(areas[1].fontSize, 'small');
        assert.deepEqual(areas[1].bounds, { x: 124, y: 124, width: 300, height: 200 });
        assert.equal(historyManager.getHistoryDepth(), depthBefore + 1);
        assert.equal(view.activeDocumentationAreaId, areas[1].id);
    });

    it('fits an area around the selected nodes with padding', () => {
        const first = graph.addNode({ type: 'test-node', x: 100, y: 100, width: 150, height: 100 });
        const second = graph.addNode({ type: 'test-node', x: 300, y: 250, width: 150, height: 100 });
        const area = graph.addDocumentationArea({ bounds: { x: 0, y: 0, width: 320, height: 200 } });
        view.selection.selectedNodes.add(first.id);
        view.selection.selectedNodes.add(second.id);
        const depthBefore = historyManager.getHistoryDepth();

        assert.equal(view._fitDocumentationAreaToSelection(area.id), true);

        assert.deepEqual(graph.getDocumentationArea(area.id).bounds, {
            x: 60,
            y: 60,
            width: 430,
            height: 330,
        });
        assert.equal(historyManager.getHistoryDepth(), depthBefore + 1);
    });

    it('clamps a fit to the minimum size', () => {
        const node = graph.addNode({ type: 'test-node', x: 50, y: 50, width: 10, height: 10 });
        const area = graph.addDocumentationArea();
        view.selection.selectedNodes.add(node.id);

        view._fitDocumentationAreaToSelection(area.id);

        const bounds = graph.getDocumentationArea(area.id).bounds;
        assert.equal(bounds.width, DOCUMENTATION_AREA_MIN_SIZE.width);
        // 10 + 2 * 40 = 90 is above the height minimum, so the height is not clamped.
        assert.equal(bounds.height, Math.max(DOCUMENTATION_AREA_MIN_SIZE.height, 90));
    });

    it('does nothing when fit has no node selection', () => {
        const area = graph.addDocumentationArea({ bounds: { x: 5, y: 5, width: 320, height: 200 } });

        assert.equal(view._fitDocumentationAreaToSelection(area.id), false);
        assert.deepEqual(graph.getDocumentationArea(area.id).bounds, {
            x: 5,
            y: 5,
            width: 320,
            height: 200,
        });
    });

    it('deletes an area through the menu action', () => {
        const area = graph.addDocumentationArea({ title: 'Menu delete' });

        assert.equal(view._removeDocumentationArea(area.id), true);
        assert.equal(graph.getDocumentationAreas().length, 0);

        historyManager.undo();
        assert.equal(graph.getDocumentationAreas().length, 1);
    });

    it('reports false for clipboard actions the facade does not implement yet', () => {
        const area = graph.addDocumentationArea({ title: 'Clipboard' });

        view.clipboard.copyArea = undefined;
        view.clipboard.cutArea = undefined;
        view.clipboard.pasteAreaAt = undefined;

        assert.equal(view._copyDocumentationArea(area.id), false);
        assert.equal(view._cutDocumentationArea(area.id), false);
        assert.equal(view._pasteDocumentationArea(area.id), false);
    });
});
