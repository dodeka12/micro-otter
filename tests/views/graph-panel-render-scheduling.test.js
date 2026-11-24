// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { AppEventEmitter } from '../../src/micro_otter/nodes/html/js/core/app-event-emitter.js';
import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';

class GraphStub extends AppEventEmitter {
    constructor() {
        super();
        this.id = 'graph-1';
    }

    getName() {
        return 'Graph 1';
    }

    getNodeIds() {
        return [];
    }

    getNodes() {
        return [];
    }

    getNode() {
        return null;
    }

    getConnections() {
        return [];
    }
}

describe('GraphPanelView render scheduling', () => {
    let originalRequestAnimationFrame;
    let originalCancelAnimationFrame;
    let rafQueue;

    beforeEach(() => {
        rafQueue = [];
        originalRequestAnimationFrame = global.requestAnimationFrame;
        originalCancelAnimationFrame = global.cancelAnimationFrame;

        global.requestAnimationFrame = (callback) => {
            rafQueue.push(callback);
            return rafQueue.length;
        };

        global.cancelAnimationFrame = () => {};
    });

    afterEach(() => {
        global.requestAnimationFrame = originalRequestAnimationFrame;
        global.cancelAnimationFrame = originalCancelAnimationFrame;
    });

    function flushNextAnimationFrame() {
        const callback = rafQueue.shift();
        assert.ok(callback, 'Expected queued requestAnimationFrame callback');
        callback();
    }

    function createView() {
        return new GraphPanelView({
            graph: new GraphStub(),
            collection: {
                getTargetId: () => null,
                getDeviceRuntimeId: () => 'general',
            },
        });
    }

    it('coalesces multiple renderPanel calls into a single RAF callback per frame', () => {
        const view = createView();
        let renderCount = 0;
        view._doRender = () => {
            renderCount += 1;
        };

        view.renderPanel();
        view.renderPanel();
        view.renderPanel();

        assert.equal(rafQueue.length, 1, 'Expected only one RAF callback to be queued');

        flushNextAnimationFrame();

        assert.equal(renderCount, 1, 'Expected one render execution for coalesced invalidations');
        view.dispose();
    });

    it('schedules a new RAF callback after previous frame execution', () => {
        const view = createView();
        let renderCount = 0;
        view._doRender = () => {
            renderCount += 1;
        };

        view.renderPanel();
        assert.equal(rafQueue.length, 1, 'Expected first RAF callback to be queued');

        flushNextAnimationFrame();
        assert.equal(renderCount, 1, 'Expected first render execution');

        view.renderPanel();
        assert.equal(rafQueue.length, 1, 'Expected second RAF callback to be queued');

        flushNextAnimationFrame();
        assert.equal(renderCount, 2, 'Expected second render execution after frame boundary');
        view.dispose();
    });

    it('preserves hidden-to-visible pending render path without losing a render', () => {
        const view = createView();
        let renderCount = 0;
        view._doRender = () => {
            renderCount += 1;
        };

        view.applyVisibilityState(false);
        view.renderPanel();
        view.renderPanel();

        assert.equal(rafQueue.length, 0, 'Expected no RAF while panel is hidden');
        assert.equal(view._pendingRenderOnShow, true, 'Expected pending-render-on-show marker');

        view.applyVisibilityState(true);
        assert.equal(rafQueue.length, 1, 'Expected one RAF when becoming visible');

        flushNextAnimationFrame();

        assert.equal(renderCount, 1, 'Expected pending render to execute after becoming visible');
        view.dispose();
    });
});
