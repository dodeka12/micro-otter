import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import ConnectionsUi from '../../src/micro_otter/nodes/html/js/nodes/connections-ui.js';

function createConnectionContext() {
    return {
        strokeCount: 0,
        save() {},
        restore() {},
        beginPath() {},
        moveTo() {},
        bezierCurveTo() {},
        stroke() {
            this.strokeCount += 1;
        },
        createLinearGradient() {
            return {
                addColorStop() {},
            };
        },
        set strokeStyle(value) {
            this._strokeStyle = value;
        },
        get strokeStyle() {
            return this._strokeStyle;
        },
        set lineWidth(value) {
            this._lineWidth = value;
        },
        get lineWidth() {
            return this._lineWidth;
        },
        set shadowColor(value) {
            this._shadowColor = value;
        },
        get shadowColor() {
            return this._shadowColor;
        },
        set shadowBlur(value) {
            this._shadowBlur = value;
        },
        get shadowBlur() {
            return this._shadowBlur;
        },
    };
}

function createNodeUi({ input, output }) {
    return {
        getConnectorPosition(kind) {
            return kind === 'output' ? output : input;
        },
    };
}

describe('ConnectionsUi viewport culling', () => {
    it('draws connections when graph.getNode depends on graph context', () => {
        const graph = {
            nodesById: {
                a: { outputs: [{ outputType: 'int' }] },
                b: { inputs: [{ allowedTypes: ['float'] }] },
            },
            getConnections: () => [{ fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 }],
            getNode(nodeId) {
                return this.nodesById[nodeId] || null;
            },
            on: () => () => {},
        };

        const ui = new ConnectionsUi({ graph });
        const nodeUiMap = new Map([
            ['a', createNodeUi({ output: { x: 10, y: 20 }, input: { x: 0, y: 0 } })],
            ['b', createNodeUi({ output: { x: 0, y: 0 }, input: { x: 80, y: 30 } })],
        ]);

        const ctx = createConnectionContext();

        assert.doesNotThrow(() => {
            ui.drawConnections(ctx, { nodeUiMap });
        });
        assert.equal(ctx.strokeCount, 1);
    });

    it('draws visible and crossing connections while skipping clearly offscreen ones', () => {
        const graph = {
            getConnections: () => [
                { fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 },
                { fromNode: 'c', fromIndex: 0, toNode: 'd', toIndex: 0 },
                { fromNode: 'e', fromIndex: 0, toNode: 'f', toIndex: 0 },
            ],
            on: () => () => {},
        };

        const ui = new ConnectionsUi({ graph });
        const nodeUiMap = new Map([
            ['a', createNodeUi({ output: { x: 10, y: 20 }, input: { x: 0, y: 0 } })],
            ['b', createNodeUi({ output: { x: 0, y: 0 }, input: { x: 80, y: 30 } })],
            ['c', createNodeUi({ output: { x: 260, y: 20 }, input: { x: 0, y: 0 } })],
            ['d', createNodeUi({ output: { x: 0, y: 0 }, input: { x: 320, y: 35 } })],
            ['e', createNodeUi({ output: { x: -40, y: 60 }, input: { x: 0, y: 0 } })],
            ['f', createNodeUi({ output: { x: 0, y: 0 }, input: { x: 18, y: 64 } })],
        ]);

        const ctx = createConnectionContext();

        ui.drawConnections(ctx, {
            nodeUiMap,
            viewportBounds: { x: 0, y: 0, width: 100, height: 100 },
        });

        assert.equal(ctx.strokeCount, 2);
    });

    it('draws all connections when viewport bounds are not provided', () => {
        const graph = {
            getConnections: () => [
                { fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 },
                { fromNode: 'c', fromIndex: 0, toNode: 'd', toIndex: 0 },
            ],
            on: () => () => {},
        };

        const ui = new ConnectionsUi({ graph });
        const nodeUiMap = new Map([
            ['a', createNodeUi({ output: { x: 10, y: 20 }, input: { x: 0, y: 0 } })],
            ['b', createNodeUi({ output: { x: 0, y: 0 }, input: { x: 80, y: 30 } })],
            ['c', createNodeUi({ output: { x: 260, y: 20 }, input: { x: 0, y: 0 } })],
            ['d', createNodeUi({ output: { x: 0, y: 0 }, input: { x: 320, y: 35 } })],
        ]);

        const ctx = createConnectionContext();

        ui.drawConnections(ctx, { nodeUiMap });

        assert.equal(ctx.strokeCount, 2);
    });

    it('disables hover shadow effects in interaction quality mode', () => {
        const connection = { fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 };
        const graph = {
            getConnections: () => [connection],
            on: () => () => {},
        };

        const ui = new ConnectionsUi({ graph });
        ui.setHoverConnection(connection);

        const nodeUiMap = new Map([
            ['a', createNodeUi({ output: { x: 10, y: 20 }, input: { x: 0, y: 0 } })],
            ['b', createNodeUi({ output: { x: 0, y: 0 }, input: { x: 80, y: 30 } })],
        ]);

        const fullCtx = createConnectionContext();
        ui.drawConnections(fullCtx, { nodeUiMap, qualityMode: 'full' });
        assert.equal(fullCtx.shadowBlur, 10);

        const interactionCtx = createConnectionContext();
        ui.drawConnections(interactionCtx, { nodeUiMap, qualityMode: 'interaction' });
        assert.equal(interactionCtx.shadowBlur, 0);
    });

    it('disables temporary connection shadow effects in interaction quality mode', () => {
        const ui = new ConnectionsUi({
            graph: {
                getConnections: () => [],
                on: () => () => {},
            },
        });

        const tempConnection = {
            start: { x: 10, y: 10 },
            end: { x: 100, y: 80 },
            startKind: 'output',
        };

        const fullCtx = createConnectionContext();
        ui.drawTempConnection(fullCtx, tempConnection, 'full');
        assert.equal(fullCtx.shadowBlur, 12);

        const interactionCtx = createConnectionContext();
        ui.drawTempConnection(interactionCtx, tempConnection, 'interaction');
        assert.equal(interactionCtx.shadowBlur, 0);
    });
});
