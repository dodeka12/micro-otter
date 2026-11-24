// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Repaint-coverage tests: graph events must repaint both canvas layers in one frame.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDomHarness } from '../helpers/dom-harness.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';

const collectionStub = {
    getTargetId: () => null,
    getDeviceRuntimeId: () => 'general',
};

// jsdom only implements requestAnimationFrame with `pretendToBeVisual`; the panel schedules every
// repaint through it, so provide a timer-backed shim.
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);

function createContextStub() {
    const noop = () => {};
    return {
        canvas: null,
        save: noop,
        restore: noop,
        setTransform: noop,
        transform: noop,
        translate: noop,
        rotate: noop,
        scale: noop,
        clearRect: noop,
        beginPath: noop,
        closePath: noop,
        moveTo: noop,
        lineTo: noop,
        quadraticCurveTo: noop,
        stroke: noop,
        fill: noop,
        fillRect: noop,
        arc: noop,
        rect: noop,
        strokeRect: noop,
        drawImage: noop,
        fillText: noop,
        setLineDash: noop,
        measureText: () => ({ width: 0 }),
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
        lineCap: 'butt',
        textBaseline: '',
        imageSmoothingEnabled: false,
        imageSmoothingQuality: '',
    };
}

function createView(graph) {
    return new GraphPanelView({
        graph,
        collection: collectionStub,
        i18nService: {
            t: (key) => key,
            addEventListener: () => {},
            removeEventListener: () => {},
            getCurrentLanguage: () => 'en',
        },
        logger: { log: () => {} },
    });
}

function nextFrame() {
    return new Promise((resolve) => {
        const schedule =
            typeof requestAnimationFrame === 'function'
                ? requestAnimationFrame
                : (callback) => setTimeout(callback, 0);
        schedule(() => resolve());
    });
}

describe('GraphPanelView documentation-area repaint coverage', () => {
    let harness;
    let graph;
    let view;
    let backgroundCalls;
    let renderCalls;

    beforeEach(() => {
        harness = createDomHarness();
        graph = new NodeGraph({ id: 'graph-1', name: 'Graph 1' });
        view = createView(graph);
        const container = document.createElement('div');
        document.body.appendChild(container);
        view.attachTo(container);
        // jsdom has no IntersectionObserver, so the panel decides it is hidden; force visible so
        // repaints are scheduled instead of deferred.
        view._isVisible = true;

        // jsdom has no 2D context, so hand the panel recording stubs.
        view.canvas.getContext = () => createContextStub();
        view.backgroundCanvas.getContext = () => createContextStub();

        backgroundCalls = [];
        renderCalls = [];
        const rendering = view.rendering;
        const originalBackground = rendering.renderBackground.bind(rendering);
        const originalRender = rendering.render.bind(rendering);
        rendering.renderBackground = (ctx, width, height, options) => {
            backgroundCalls.push(options);
            return originalBackground(ctx, width, height, options);
        };
        rendering.render = (ctx, width, height, options) => {
            renderCalls.push(options);
            return originalRender(ctx, width, height, options);
        };
    });

    afterEach(() => {
        view.dispose();
        harness.cleanup();
    });

    it('repaints both layers once for a documentation-area bounds change', async () => {
        const area = graph.addDocumentationArea({
            title: 'Doc',
            bounds: { x: 10, y: 20, width: 300, height: 200 },
        });
        await nextFrame();
        backgroundCalls.length = 0;
        renderCalls.length = 0;

        graph.setDocumentationAreaBounds(area.id, { x: 40, y: 50, width: 300, height: 200 });
        await nextFrame();

        assert.equal(backgroundCalls.length, 1);
        assert.equal(renderCalls.length, 1);
        assert.equal(backgroundCalls[0].documentationAreas.length, 1);
        assert.deepEqual(backgroundCalls[0].documentationAreas[0].bounds, {
            x: 40,
            y: 50,
            width: 300,
            height: 200,
        });
    });

    it('keeps the grid on the background layer and off the node canvas', async () => {
        await nextFrame();
        backgroundCalls.length = 0;
        renderCalls.length = 0;

        view.renderPanel();
        await nextFrame();

        assert.equal(backgroundCalls.length, 1);
        assert.equal(backgroundCalls[0].showGrid, true);
        assert.equal(renderCalls.length, 1);
        assert.equal(renderCalls[0].showGrid, false);
    });

    it('passes the active area id to the background layer', async () => {
        const area = graph.addDocumentationArea({ title: 'Active' });
        view.activeDocumentationAreaId = area.id;
        await nextFrame();
        backgroundCalls.length = 0;

        view.renderPanel();
        await nextFrame();

        assert.equal(backgroundCalls[0].activeAreaId, area.id);
    });
});
