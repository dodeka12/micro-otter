import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import ConnectionsUi from '../../src/micro_otter/nodes/html/js/nodes/connections-ui.js';

function createConnectionContext() {
    const strokes = [];
    return {
        strokes,
        save() {},
        restore() {},
        beginPath() {},
        moveTo() {},
        bezierCurveTo() {},
        stroke() {
            strokes.push({
                style: this._strokeStyle,
                lineWidth: this._lineWidth,
                shadowBlur: this._shadowBlur,
                shadowColor: this._shadowColor,
            });
        },
        createLinearGradient() {
            return { addColorStop() {} };
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

function createNodeUi({ output, input }) {
    return {
        getConnectorPosition(kind) {
            return kind === 'output' ? output : input;
        },
    };
}

describe('ConnectionsUi selection highlighting', () => {
    it('draws a halo for connections touching a highlighted node', () => {
        const graph = {
            getConnections: () => [
                { fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 },
                { fromNode: 'c', fromIndex: 0, toNode: 'd', toIndex: 0 },
            ],
            on: () => () => {},
            getNode() {
                return null;
            },
        };

        const ui = new ConnectionsUi({ graph });
        ui.setHighlightedNodes(['a']);

        const nodeUiMap = new Map([
            ['a', createNodeUi({ output: { x: 10, y: 20 }, input: { x: 0, y: 0 } })],
            ['b', createNodeUi({ output: { x: 0, y: 0 }, input: { x: 80, y: 30 } })],
            ['c', createNodeUi({ output: { x: 10, y: 20 }, input: { x: 0, y: 0 } })],
            ['d', createNodeUi({ output: { x: 0, y: 0 }, input: { x: 80, y: 30 } })],
        ]);

        const ctx = createConnectionContext();
        ui.drawConnections(ctx, { nodeUiMap });

        // Highlighted connection: halo + normal stroke. Unrelated: single stroke.
        assert.equal(ctx.strokes.length, 3);
        assert.equal(ctx.strokes[0].shadowBlur, 10);
        assert.equal(ctx.strokes[1].shadowBlur, 0);
        assert.equal(ctx.strokes[2].shadowBlur, 0);
    });

    it('disables the halo shadow in interaction quality mode', () => {
        const graph = {
            getConnections: () => [{ fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 }],
            on: () => () => {},
            getNode() {
                return null;
            },
        };

        const ui = new ConnectionsUi({ graph });
        ui.setHighlightedNodes(['a']);

        const nodeUiMap = new Map([
            ['a', createNodeUi({ output: { x: 10, y: 20 }, input: { x: 0, y: 0 } })],
            ['b', createNodeUi({ output: { x: 0, y: 0 }, input: { x: 80, y: 30 } })],
        ]);

        const ctx = createConnectionContext();
        ui.drawConnections(ctx, { nodeUiMap, qualityMode: 'interaction' });

        assert.equal(ctx.strokes.length, 2);
        assert.equal(ctx.strokes[0].shadowBlur, 0);
    });
});
