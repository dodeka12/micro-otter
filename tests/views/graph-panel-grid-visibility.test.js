// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GraphPanelRendering } from '../../src/micro_otter/nodes/html/js/views/graph-panel-rendering.js';
import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';

function createRenderContext() {
    return {
        strokeCount: 0,
        save() {},
        restore() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {
            this.strokeCount += 1;
        },
        fill() {},
        fillRect() {},
        closePath() {},
        strokeStyle: '',
        lineWidth: 0,
        lineCap: '',
        fillStyle: '',
    };
}

function createRendering() {
    return new GraphPanelRendering({
        constants: { GRID_SPACING: 32, GRID_MAJOR_INTERVAL: 5 },
        viewport: { screenToWorld: (point) => point },
        connectionsUi: {
            drawConnections: () => {},
            drawTempConnection: () => {},
        },
    });
}

function createViewLike() {
    return {
        gridEnabled: true,
        showGrid: true,
        renderCount: 0,
        renderPanel() {
            this.renderCount += 1;
        },
        _log() {},
    };
}

describe('grid visibility is independent of grid snapping', () => {
    it('draws the grid while snapping is disabled', () => {
        const ctx = createRenderContext();

        createRendering().render(ctx, 100, 100, {
            // Snapping is off, but the "Show Grid" toggle is on: grid lines must still be drawn.
            gridEnabled: false,
            showGrid: true,
            nodeUiMap: new Map(),
            nodeOrderList: [],
            selectedNodeIds: new Set(),
        });

        assert.ok(ctx.strokeCount > 0, 'expected grid lines to be stroked');
    });

    it('skips the grid when "Show Grid" is off even with snapping enabled', () => {
        const ctx = createRenderContext();

        createRendering().render(ctx, 100, 100, {
            gridEnabled: true,
            showGrid: false,
            nodeUiMap: new Map(),
            nodeOrderList: [],
            selectedNodeIds: new Set(),
        });

        assert.equal(ctx.strokeCount, 0);
    });

    it('toggling snapping leaves grid visibility untouched', () => {
        const viewLike = createViewLike();

        GraphPanelView.prototype._handleCanvasContextMenuSelect.call(
            viewLike,
            { id: 'gridSnap' },
            {}
        );

        assert.equal(viewLike.gridEnabled, false);
        assert.equal(viewLike.showGrid, true);
        assert.equal(viewLike.renderCount, 1);
    });

    it('toggling grid visibility leaves snapping untouched', () => {
        const viewLike = createViewLike();

        GraphPanelView.prototype._handleCanvasContextMenuSelect.call(
            viewLike,
            { id: 'showGrid' },
            {}
        );

        assert.equal(viewLike.showGrid, false);
        assert.equal(viewLike.gridEnabled, true);
        assert.equal(viewLike.renderCount, 1);
    });
});
