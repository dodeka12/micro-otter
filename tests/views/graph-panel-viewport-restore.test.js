// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Viewport restore, centering and persistence tests for GraphPanelView.
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
global.CustomEvent = dom.window.CustomEvent;
global.EventTarget = dom.window.EventTarget;
global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
};
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

import { GraphPanelViewport } from '../../src/micro_otter/nodes/html/js/views/graph-panel-viewport.js';
import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';
import { ViewportConfig } from '../../src/micro_otter/nodes/html/js/data/viewport-config.js';

/** 800x600 canvas keeps the clamp range easy to reason about (maxX/maxY are 80 at scale 1). */
const CANVAS_SIZE = { width: 800, height: 600 };

/** Grid world center for `maxGridMajorIntervals = {128, 64}` at 160 px per major interval. */
const GRID_WORLD_CENTER = { x: 10240, y: 5120 };

/**
 * Build a viewport with the same grid constants GraphPanelView uses.
 * @param {object} [options] - Extra constructor options.
 * @returns {GraphPanelViewport} Viewport using the panel's grid defaults.
 */
function createViewport(options = {}) {
    return new GraphPanelViewport({
        constants: { GRID_SPACING: 32, GRID_MAJOR_INTERVAL: 5 },
        maxGridMajorIntervals: { width: 128, height: 64 },
        ...options,
    });
}

/**
 * Assert two numbers match within a tolerance.
 * @param {number} actual - Measured value.
 * @param {number} expected - Expected value.
 * @param {number} [tolerance] - Allowed absolute difference (default 1).
 * @returns {void}
 */
function assertClose(actual, expected, tolerance = 1) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `expected ${actual} to be within ${tolerance} of ${expected}`
    );
}

const collectionStub = {
    getTargetId: () => null,
    getDeviceRuntimeId: () => 'general',
};

/**
 * Graph stub with only the members GraphPanelView touches during attach and viewport work.
 *
 * `getNodeIds` stays empty and `getNode` is absent so no `NodeUi` instances are created and the
 * asynchronous capability revalidation exits immediately. `setViewportConfig` dispatches a
 * `viewport` event to registered listeners so a test can prove that opening a graph writes nothing.
 * @param {object} [options] - Graph content and stored viewport.
 * @param {object[]} [options.nodes] - Graph nodes used for content-bounds resolution.
 * @param {object[]} [options.documentationAreas] - Documentation areas used for bounds.
 * @param {object} [options.viewport] - Stored viewport config.
 * @returns {{graph: object, writes: object[], events: object[],
 *   getStoredViewport: () => ViewportConfig}} Stub graph, recorded writes, recorded `viewport`
 *   events and a reader for the stored config.
 */
function createGraphStub({ nodes = [], documentationAreas = [], viewport = {} } = {}) {
    const writes = [];
    const events = [];
    /** @type {{eventName:string, listener:(event: object) => void}[]} */
    const listeners = [];
    let storedViewport = new ViewportConfig(viewport);

    /**
     * Deliver one graph event to the listeners registered for that name or for `*`.
     * @param {string} eventName - Emitted event name.
     * @param {object} detail - Event payload.
     */
    const emit = (eventName, detail) => {
        const event = { name: eventName, detail };
        if (eventName === 'viewport') {
            events.push(event);
        }
        listeners
            .filter((entry) => entry.eventName === '*' || entry.eventName === eventName)
            .forEach((entry) => entry.listener(event));
    };

    const graph = {
        id: 'graph-under-test',
        getName: () => 'Graph Under Test',
        getNodeIds: () => [],
        getNodes: () => nodes,
        getDocumentationAreas: () => documentationAreas,
        getViewportConfig: () => storedViewport,
        setViewportConfig: (config) => {
            writes.push({
                scale: config.scale,
                translateX: config.translateX,
                translateY: config.translateY,
            });
            storedViewport = config.clone();
            emit('viewport', { graphId: graph.id, viewport: storedViewport });
            return graph;
        },
        on: (eventName, listener) => {
            const entry = { eventName, listener };
            listeners.push(entry);
            return () => {
                const index = listeners.indexOf(entry);
                if (index >= 0) {
                    listeners.splice(index, 1);
                }
            };
        },
    };

    return { graph, writes, events, getStoredViewport: () => storedViewport };
}

/**
 * Create, attach and return a graph panel plus its host element.
 * @param {object} graph - Graph stub bound to the panel.
 * @param {object} [collection] - Collection stub override.
 * @returns {{view: GraphPanelView, container: HTMLElement}} Attached panel and its host.
 */
function createAttachedView(graph, collection = collectionStub) {
    const view = new GraphPanelView({
        graph,
        collection,
        i18nService: {
            t: (key) => key,
            addEventListener: () => {},
            removeEventListener: () => {},
        },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    view.attachTo(container);
    return { view, container };
}

/**
 * jsdom never computes layout, so canvas client sizes are zero unless overridden explicitly.
 * @param {GraphPanelView} view - Panel whose canvas is measured.
 * @param {number} width - Canvas client width in pixels.
 * @param {number} height - Canvas client height in pixels.
 */
function setCanvasClientSize(view, width, height) {
    Object.defineProperty(view.canvas, 'clientWidth', { configurable: true, value: width });
    Object.defineProperty(view.canvas, 'clientHeight', { configurable: true, value: height });
}

/**
 * Dispatch one wheel notch through the panel handler.
 * @param {GraphPanelView} view - Panel receiving the wheel event.
 * @param {number} deltaY - Negative zooms in, positive zooms out.
 */
function wheel(view, deltaY) {
    view.handleWheel({ deltaY, clientX: 10, clientY: 10, preventDefault: () => {} });
}

describe('GraphPanelViewport centering and change notification', () => {
    it('centers the grid world center on the canvas at the current scale', () => {
        const viewport = createViewport();

        viewport.centerOnWorldPoint(GRID_WORLD_CENTER, CANVAS_SIZE);

        const screen = viewport.worldToScreen(GRID_WORLD_CENTER);
        assertClose(screen.x, CANVAS_SIZE.width / 2);
        assertClose(screen.y, CANVAS_SIZE.height / 2);
        assert.equal(viewport.viewport.scale, 1);
    });

    it('clamps a near-origin center to the grid translate range instead of centering', () => {
        const viewport = createViewport();

        viewport.centerOnWorldPoint({ x: 100, y: 100 }, CANVAS_SIZE);

        const range = viewport.evalGridViewportTranslateRange(CANVAS_SIZE);
        assert.equal(range.maxX, 80);
        assert.equal(range.maxY, 80);
        assert.equal(viewport.viewport.translateX, range.maxX);
        assert.equal(viewport.viewport.translateY, range.maxY);
    });

    it('ignores a non-finite point or a non-positive canvas size', () => {
        const viewport = createViewport();

        viewport.centerOnWorldPoint({ x: Number.NaN, y: 0 }, CANVAS_SIZE);
        viewport.centerOnWorldPoint(GRID_WORLD_CENTER, { width: 0, height: 0 });

        assert.deepEqual(viewport.serialize(), { scale: 1, translateX: 0, translateY: 0 });
    });

    it('notifies exactly once per setViewport and once per zoomAt', () => {
        const states = [];
        const viewport = createViewport({ onViewportChange: (state) => states.push(state) });

        viewport.setViewport({ translateX: -40 }, CANVAS_SIZE);
        assert.equal(states.length, 1);
        assert.deepEqual(states[0], viewport.serialize());

        viewport.zoomAt({ x: 10, y: 10 }, 1.05, CANVAS_SIZE);
        assert.equal(states.length, 2);
        assert.deepEqual(states[1], viewport.serialize());
    });

    it('does not notify when restoring serialized layout state', () => {
        const states = [];
        const viewport = createViewport({ onViewportChange: (state) => states.push(state) });

        viewport.deserialize({ viewport: { scale: 1.5, translateX: -20, translateY: -30 } });

        assert.equal(states.length, 0);
        assert.deepEqual(viewport.serialize(), { scale: 1.5, translateX: -20, translateY: -30 });
    });

    it('returns the workspace default zoom clamped to the scale range', () => {
        assert.equal(createViewport().getDefaultScale(), 1);
        assert.equal(
            createViewport({ workspace: { config: { viewport: { defaultZoom: 1.5 } } } })
                .getDefaultScale(),
            1.5
        );
        assert.equal(
            createViewport({ workspace: { config: { viewport: { defaultZoom: 9 } } } })
                .getDefaultScale(),
            2.75
        );
        assert.equal(
            createViewport({ workspace: { config: { viewport: { defaultZoom: 0.01 } } } })
                .getDefaultScale(),
            0.275
        );
    });

    it('survives a failing change listener', () => {
        const viewport = createViewport({
            onViewportChange: () => {
                throw new Error('listener boom');
            },
        });
        const originalError = console.error;
        console.error = () => {};
        try {
            viewport.setViewport({ translateX: -40 }, CANVAS_SIZE);
        } finally {
            console.error = originalError;
        }

        assert.equal(viewport.viewport.translateX, -40);
    });
});

describe('GraphPanelView wheel zoom step', () => {
    it('zooms in by 5 % per notch instead of the former 10 %', () => {
        const { graph } = createGraphStub();
        const { view, container } = createAttachedView(graph);

        wheel(view, -100);

        assertClose(view.viewportModule.viewport.scale, 1.05, 1e-9);
        assert.ok(
            view.viewportModule.viewport.scale < 1.1,
            'a 10 % step would have produced 1.1'
        );

        view.dispose();
        container.remove();
    });

    it('zooms out by exactly one step per notch', () => {
        const { graph } = createGraphStub();
        const { view, container } = createAttachedView(graph);

        wheel(view, 100);

        assertClose(view.viewportModule.viewport.scale, 1 / 1.05, 1e-9);

        view.dispose();
        container.remove();
    });

    it('returns to the starting scale after one notch in and one notch out', () => {
        const { graph } = createGraphStub();
        const { view, container } = createAttachedView(graph);

        wheel(view, -100);
        wheel(view, 100);

        assertClose(view.viewportModule.viewport.scale, 1, 1e-9);

        view.dispose();
        container.remove();
    });

    it('keeps the world point under the pointer fixed while zooming', () => {
        const { graph } = createGraphStub();
        const { view, container } = createAttachedView(graph);
        const pointer = { x: 10, y: 10 };

        view.setViewport({ translateX: -120, translateY: -80 });
        const worldBefore = view.screenToWorld(pointer);
        wheel(view, -100);
        const worldAfter = view.screenToWorld(pointer);

        assertClose(worldAfter.x, worldBefore.x, 1e-9);
        assertClose(worldAfter.y, worldBefore.y, 1e-9);

        view.dispose();
        container.remove();
    });

    it('clamps repeated zoom-ins at maxScale', () => {
        const { graph } = createGraphStub();
        const { view, container } = createAttachedView(graph);

        // 1.05^n reaches maxScale (2.75) after 21 notches; keep going to prove the clamp holds.
        for (let index = 0; index < 40; index += 1) {
            wheel(view, -100);
        }

        assert.equal(view.viewportModule.viewport.scale, view.viewportModule.viewport.maxScale);

        view.dispose();
        container.remove();
    });
});

describe('GraphPanelView viewport persistence', () => {
    it('debounces a viewport change into a single graph write after 250 ms', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { graph, writes } = createGraphStub();
        const { view, container } = createAttachedView(graph);

        setCanvasClientSize(view, 800, 600);
        view.setViewport({ translateX: -40 });

        t.mock.timers.tick(249);
        assert.equal(writes.length, 0, 'no write before the debounce elapses');

        t.mock.timers.tick(1);
        assert.deepEqual(writes, [{ scale: 1, translateX: -40, translateY: 0 }]);

        view.dispose();
        container.remove();
    });

    it('collapses a burst of changes into one write carrying the newest values', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { graph, writes } = createGraphStub();
        const { view, container } = createAttachedView(graph);

        setCanvasClientSize(view, 800, 600);
        view.setViewport({ translateX: -40 });
        t.mock.timers.tick(100);
        view.setViewport({ translateX: -80, translateY: -60 });
        t.mock.timers.tick(249);
        assert.equal(writes.length, 0, 'the reset debounce window is still open');

        t.mock.timers.tick(1);
        assert.deepEqual(writes, [{ scale: 1, translateX: -80, translateY: -60 }]);

        view.dispose();
        container.remove();
    });

    it('skips the write when the viewport already matches the stored config', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { graph, writes } = createGraphStub();
        const { view, container } = createAttachedView(graph);

        view.setViewport({ translateX: 0, translateY: 0, scale: 1 });
        t.mock.timers.tick(250);

        assert.equal(writes.length, 0);

        view.dispose();
        container.remove();
    });

    it('persists through the graph and never through the collection', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let collectionWrites = 0;
        const collection = {
            ...collectionStub,
            setViewportConfig: () => {
                collectionWrites += 1;
            },
        };
        const { graph, writes } = createGraphStub();
        const { view, container } = createAttachedView(graph, collection);

        setCanvasClientSize(view, 800, 600);
        view.setViewport({ translateX: -40 });
        t.mock.timers.tick(250);

        assert.equal(writes.length, 1);
        assert.equal(collectionWrites, 0, 'Collection#setViewportConfig would double the event');

        view.dispose();
        container.remove();
    });

    it('ignores graphs without a viewport API', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const graph = {
            id: 'no-viewport-api',
            getName: () => 'No Viewport API',
            getNodeIds: () => [],
            getNodes: () => [],
            getDocumentationAreas: () => [],
            on: () => null,
        };
        const { view, container } = createAttachedView(graph);

        setCanvasClientSize(view, 800, 600);
        view.setViewport({ translateX: -40 });

        assert.doesNotThrow(() => t.mock.timers.tick(250));
        assert.equal(view.viewportModule.viewport.translateX, -40);

        view.dispose();
        container.remove();
    });

    it('flushes a pending write when the panel is disposed', () => {
        const { graph, writes } = createGraphStub();
        const view = new GraphPanelView({
            graph,
            collection: collectionStub,
            i18nService: {
                t: (key) => key,
                addEventListener: () => {},
                removeEventListener: () => {},
            },
        });
        view.setViewport({ translateX: -40 });

        // No timer tick: dispose() must not drop the gesture.
        view.dispose();

        assert.deepEqual(writes, [{ scale: 1, translateX: -40, translateY: 0 }]);
    });
});

describe('GraphPanelView initial viewport', () => {
    /**
     * Attach a view, give its canvas a real size, and run the initial-size hook.
     * @param {object} graph - Graph stub bound to the panel.
     * @param {{width:number,height:number}} [size] - Canvas size to simulate.
     * @returns {{view: GraphPanelView, container: HTMLElement}} Opened panel and its host.
     */
    function openView(graph, size = { width: 800, height: 600 }) {
        const { view, container } = createAttachedView(graph);
        setCanvasClientSize(view, size.width, size.height);
        view.onInitialSize(size);
        return { view, container };
    }

    it('centers an empty graph on the grid world center without writing to the graph', () => {
        const { graph, writes, events } = createGraphStub();
        const { view, container } = openView(graph);

        const gridCenter = {
            x: view.gridSizeWorld.width / 2,
            y: view.gridSizeWorld.height / 2,
        };
        const screen = view.worldToScreen(gridCenter);

        assertClose(screen.x, 400, 1e-9);
        assertClose(screen.y, 300, 1e-9);
        assert.equal(view.viewportModule.viewport.scale, 1);
        assert.equal(writes.length, 0, 'opening a graph never persists the viewport');
        assert.equal(events.length, 0, 'opening a graph never emits a viewport event');

        view.dispose();
        container.remove();
    });

    it('centers the union bounds of the graph nodes', () => {
        const { graph, writes, events } = createGraphStub({
            nodes: [
                { id: 'a', x: 6000, y: 6000, width: 400, height: 200 },
                { id: 'b', x: 7000, y: 6500, width: 400, height: 200 },
            ],
        });
        const { view, container } = openView(graph);

        // Union box: x 6000..7400, y 6000..6700.
        const screen = view.worldToScreen({ x: 6700, y: 6350 });

        assertClose(screen.x, 400, 1e-9);
        assertClose(screen.y, 300, 1e-9);
        assert.equal(writes.length, 0);
        assert.equal(events.length, 0);

        view.dispose();
        container.remove();
    });

    it('centers documentation-area bounds when the graph has no nodes', () => {
        const { graph } = createGraphStub({
            documentationAreas: [
                { id: 'area', bounds: { x: 4000, y: 3000, width: 800, height: 400 } },
            ],
        });
        const { view, container } = openView(graph);

        const screen = view.worldToScreen({ x: 4400, y: 3200 });

        assertClose(screen.x, 400, 1e-9);
        assertClose(screen.y, 300, 1e-9);

        view.dispose();
        container.remove();
    });

    it('clamps the centering of content near the world origin to the grid translate range', () => {
        const { graph } = createGraphStub({
            nodes: [{ id: 'a', x: 0, y: 0, width: 200, height: 100 }],
        });
        const { view, container } = openView(graph);

        // Ideal center is world {100, 50}; maxX/maxY are half a major interval (80 at scale 1).
        assert.deepEqual(view.viewportModule.serialize(), {
            scale: 1,
            translateX: 80,
            translateY: 80,
        });

        view.dispose();
        container.remove();
    });

    it('restores a stored viewport verbatim without rewriting it', () => {
        const { graph, writes, events } = createGraphStub({
            viewport: { translateX: -120, translateY: -240, scale: 0.5 },
        });
        const { view, container } = openView(graph);

        assert.deepEqual(view.viewportModule.serialize(), {
            scale: 0.5,
            translateX: -120,
            translateY: -240,
        });
        assert.equal(writes.length, 0);
        assert.equal(events.length, 0);

        view.dispose();
        container.remove();
    });

    it('clamps a stored viewport that lies outside the grid translate range', () => {
        const { graph, writes, events } = createGraphStub({
            viewport: { translateX: 500, translateY: 500, scale: 1 },
        });
        const { view, container } = openView(graph);

        assert.deepEqual(view.viewportModule.serialize(), {
            scale: 1,
            translateX: 80,
            translateY: 80,
        });
        assert.equal(writes.length, 0, 'clamping must not be written back on open');
        assert.equal(events.length, 0, 'clamping must not emit a viewport event on open');

        view.dispose();
        container.remove();
    });

    it('ignores a zero-sized first measurement and centers on the next real size', () => {
        const { graph } = createGraphStub();
        const { view, container } = createAttachedView(graph);

        view.onInitialSize({ width: 0, height: 0 });
        assert.equal(view._initialViewportApplied, false);

        setCanvasClientSize(view, 800, 600);
        view.onInitialSize({ width: 800, height: 600 });
        assert.equal(view._initialViewportApplied, true);
        assertClose(view.worldToScreen({ x: 10240, y: 5120 }).x, 400, 1e-9);

        const applied = view.viewportModule.serialize();
        view.onInitialSize({ width: 1000, height: 700 });
        assert.deepEqual(view.viewportModule.serialize(), applied, 'resolution runs once');

        view.dispose();
        container.remove();
    });

    it('resolves the opening viewport again after setGraph', () => {
        const first = createGraphStub();
        const { view, container } = openView(first.graph);
        assert.equal(view._initialViewportApplied, true);

        const second = createGraphStub({
            viewport: { translateX: -120, translateY: -240, scale: 0.5 },
        });
        view.setGraph(second.graph);

        assert.deepEqual(view.viewportModule.serialize(), {
            scale: 0.5,
            translateX: -120,
            translateY: -240,
        });
        assert.equal(first.writes.length, 0);
        assert.equal(second.writes.length, 0);

        view.dispose();
        container.remove();
    });
});
