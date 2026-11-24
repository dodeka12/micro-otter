import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import ConnectionsUi from '../../src/micro_otter/nodes/html/js/nodes/connections-ui.js';
import {
    clampConnectionControlOffset,
    getConnectionControlOffset,
    CONNECTION_CURVE_BACKWARD_LOOP,
    CONNECTION_CURVE_MAX_CONTROL_OFFSET,
    CONNECTION_CURVE_MIN_CONTROL_OFFSET,
} from '../../src/micro_otter/nodes/html/js/nodes/connection-geometry.js';
import { CONNECTOR_RADIUS } from '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js';
import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';

function cubicPoint(t, start, control1, control2, end) {
    const u = 1 - t;
    return {
        x:
            u * u * u * start.x +
            3 * u * u * t * control1.x +
            3 * u * t * t * control2.x +
            t * t * t * end.x,
        y:
            u * u * u * start.y +
            3 * u * u * t * control1.y +
            3 * u * t * t * control2.y +
            t * t * t * end.y,
    };
}

function sampleExtent(start, control1, control2, end) {
    let minX = start.x;
    let maxX = start.x;
    for (let index = 0; index <= 200; index += 1) {
        const point = cubicPoint(index / 200, start, control1, control2, end);
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
    }
    return { minX, maxX };
}

function createRecordingConnectionContext() {
    return {
        moves: [],
        curves: [],
        save() {},
        restore() {},
        beginPath() {},
        moveTo(x, y) {
            this.moves.push({ x, y });
        },
        bezierCurveTo(control1X, control1Y, control2X, control2Y, endX, endY) {
            this.curves.push({
                control1: { x: control1X, y: control1Y },
                control2: { x: control2X, y: control2Y },
                end: { x: endX, y: endY },
            });
        },
        stroke() {},
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

function createNodeUi({ input, output }) {
    return {
        getConnectorPosition(kind) {
            return kind === 'output' ? output : input;
        },
    };
}

function createGraph(connections) {
    return {
        getConnections: () => connections,
        on: () => () => {},
    };
}

function curveFromRecording(ctx) {
    const move = ctx.moves[0];
    const curve = ctx.curves[0];
    return {
        start: { x: move.x, y: move.y },
        control1: curve.control1,
        control2: curve.control2,
        end: curve.end,
    };
}

describe('connection curve geometry helpers', () => {
    it('uses a proportional, capped bend for forward connections', () => {
        assert.equal(getConnectionControlOffset(0, 10), 60);
        assert.equal(getConnectionControlOffset(100, 200), 100);
        assert.equal(getConnectionControlOffset(0, 400), 120);
        assert.equal(getConnectionControlOffset(0, 2000), 120);
    });

    it('grows the backward bend just enough to keep the loop fixed', () => {
        assert.ok(getConnectionControlOffset(200, 0) > CONNECTION_CURVE_MAX_CONTROL_OFFSET);
        assert.ok(getConnectionControlOffset(2000, 0) > getConnectionControlOffset(200, 0));
        assert.ok(getConnectionControlOffset(5000, 0) > getConnectionControlOffset(2000, 0));
    });

    it('clamps arbitrary offsets into the allowed range', () => {
        assert.equal(clampConnectionControlOffset(-5), CONNECTION_CURVE_MIN_CONTROL_OFFSET);
        assert.equal(clampConnectionControlOffset(60), CONNECTION_CURVE_MIN_CONTROL_OFFSET);
        assert.equal(clampConnectionControlOffset(80), 80);
        assert.equal(clampConnectionControlOffset(2000), CONNECTION_CURVE_MAX_CONTROL_OFFSET);
    });
});

describe('ConnectionsUi connection curve bend', () => {
    it('keeps a fixed, visible loop for far-apart backward connections', () => {
        const ui = new ConnectionsUi({
            graph: createGraph([{ fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 }]),
        });
        const nodeUiMap = new Map([
            ['a', createNodeUi({ output: { x: 1200, y: 40 }, input: { x: 0, y: 0 } })],
            ['b', createNodeUi({ output: { x: 0, y: 0 }, input: { x: 100, y: 300 } })],
        ]);
        const ctx = createRecordingConnectionContext();

        ui.drawConnections(ctx, { nodeUiMap });

        assert.equal(ctx.curves.length, 1);
        const { start, control1, control2, end } = curveFromRecording(ctx);

        assert.equal(start.x, 1200 + CONNECTOR_RADIUS);
        assert.equal(end.x, 104);

        const extent = sampleExtent(start, control1, control2, end);
        const rightLoop = extent.maxX - start.x;
        const leftLoop = end.x - extent.minX;
        assert.ok(Math.abs(rightLoop - CONNECTION_CURVE_BACKWARD_LOOP) < 3, `right loop ${rightLoop}`);
        assert.ok(Math.abs(leftLoop - CONNECTION_CURVE_BACKWARD_LOOP) < 3, `left loop ${leftLoop}`);
    });

    it('keeps the same loop size no matter how far apart the backward nodes are', () => {
        const render = (outputX) => {
            const ui = new ConnectionsUi({
                graph: createGraph([{ fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 }]),
            });
            const nodeUiMap = new Map([
                ['a', createNodeUi({ output: { x: outputX, y: 40 }, input: { x: 0, y: 0 } })],
                ['b', createNodeUi({ output: { x: 0, y: 0 }, input: { x: 100, y: 300 } })],
            ]);
            const ctx = createRecordingConnectionContext();
            ui.drawConnections(ctx, { nodeUiMap });
            const { start, control1, control2, end } = curveFromRecording(ctx);
            const extent = sampleExtent(start, control1, control2, end);
            return {
                start,
                end,
                rightLoop: extent.maxX - start.x,
                leftLoop: end.x - extent.minX,
            };
        };

        const near = render(1200);
        const far = render(5000);

        assert.ok(Math.abs(near.rightLoop - CONNECTION_CURVE_BACKWARD_LOOP) < 3, `near right ${near.rightLoop}`);
        assert.ok(Math.abs(far.rightLoop - CONNECTION_CURVE_BACKWARD_LOOP) < 3, `far right ${far.rightLoop}`);
        assert.ok(Math.abs(near.leftLoop - CONNECTION_CURVE_BACKWARD_LOOP) < 3, `near left ${near.leftLoop}`);
        assert.ok(Math.abs(far.leftLoop - CONNECTION_CURVE_BACKWARD_LOOP) < 3, `far left ${far.leftLoop}`);
    });

    it('caps the bend for long forward connections too', () => {
        const ui = new ConnectionsUi({
            graph: createGraph([{ fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 }]),
        });
        const nodeUiMap = new Map([
            ['a', createNodeUi({ output: { x: 100, y: 40 }, input: { x: 0, y: 0 } })],
            ['b', createNodeUi({ output: { x: 0, y: 0 }, input: { x: 2100, y: 300 } })],
        ]);
        const ctx = createRecordingConnectionContext();

        ui.drawConnections(ctx, { nodeUiMap });

        const { start, control1, control2, end } = curveFromRecording(ctx);
        assert.equal(control1.x - start.x, CONNECTION_CURVE_MAX_CONTROL_OFFSET);
        // control2 is offset from the raw input x while the line extends 4px into the socket.
        assert.equal(end.x - control2.x, CONNECTION_CURVE_MAX_CONTROL_OFFSET + 4);

        const extent = sampleExtent(start, control1, control2, end);
        assert.ok(extent.minX >= start.x, 'forward curve must not go left of the output');
        assert.ok(extent.maxX <= end.x, 'forward curve must not go right of the input');
    });

    it('keeps a fixed loop on backward drag previews', () => {
        const ui = new ConnectionsUi({ graph: createGraph([]) });

        const fromOutputCtx = createRecordingConnectionContext();
        ui.drawTempConnection(fromOutputCtx, {
            start: { x: 1200, y: 40 },
            end: { x: 100, y: 300 },
            startKind: 'output',
        });
        const fromOutput = curveFromRecording(fromOutputCtx);
        const outputExtent = sampleExtent(
            fromOutput.start,
            fromOutput.control1,
            fromOutput.control2,
            fromOutput.end
        );
        assert.equal(fromOutput.start.x, 1204);
        assert.equal(fromOutput.end.x, 104);
        assert.ok(
            Math.abs((outputExtent.maxX - fromOutput.start.x) - CONNECTION_CURVE_BACKWARD_LOOP) < 3
        );
        assert.ok(
            Math.abs((fromOutput.end.x - outputExtent.minX) - CONNECTION_CURVE_BACKWARD_LOOP) < 3
        );

        const fromInputCtx = createRecordingConnectionContext();
        ui.drawTempConnection(fromInputCtx, {
            start: { x: 100, y: 300 },
            end: { x: 1200, y: 40 },
            startKind: 'input',
        });
        const fromInput = curveFromRecording(fromInputCtx);
        const inputExtent = sampleExtent(
            fromInput.start,
            fromInput.control1,
            fromInput.control2,
            fromInput.end
        );
        assert.equal(fromInput.start.x, 104);
        assert.equal(fromInput.end.x, 1204);
        assert.ok(
            Math.abs((fromInput.start.x - inputExtent.minX) - CONNECTION_CURVE_BACKWARD_LOOP) < 3
        );
        assert.ok(
            Math.abs((inputExtent.maxX - fromInput.end.x) - CONNECTION_CURVE_BACKWARD_LOOP) < 3
        );
    });

    it('keeps the gentler proportional bend on forward drag previews', () => {
        const ui = new ConnectionsUi({ graph: createGraph([]) });
        const ctx = createRecordingConnectionContext();
        ui.drawTempConnection(ctx, {
            start: { x: 100, y: 40 },
            end: { x: 1200, y: 300 },
            startKind: 'output',
        });
        const { start, control1, control2, end } = curveFromRecording(ctx);
        assert.equal(control1.x - start.x, CONNECTION_CURVE_MAX_CONTROL_OFFSET);
        assert.equal(end.x - control2.x, CONNECTION_CURVE_MAX_CONTROL_OFFSET);
    });
});

describe('connection curve hit testing matches rendering', () => {
    it('reports zero distance for a point sampled from the drawn curve', () => {
        const ui = new ConnectionsUi({
            graph: createGraph([{ fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 }]),
        });
        const nodeUiMap = new Map([
            ['a', createNodeUi({ output: { x: 1200, y: 40 }, input: { x: 0, y: 0 } })],
            ['b', createNodeUi({ output: { x: 0, y: 0 }, input: { x: 100, y: 300 } })],
        ]);
        const ctx = createRecordingConnectionContext();

        ui.drawConnections(ctx, { nodeUiMap });
        const { start, control1, control2, end } = curveFromRecording(ctx);
        const midpoint = cubicPoint(0.5, start, control1, control2, end);

        const viewLike = {
            constants: { CONNECTOR_RADIUS },
            _evaluateBezierPoint: GraphPanelView.prototype._evaluateBezierPoint,
            _pointToSegmentDistance: GraphPanelView.prototype._pointToSegmentDistance,
        };
        const distance = GraphPanelView.prototype._distanceToConnectionCurve.call(
            viewLike,
            midpoint,
            { x: 1200, y: 40 },
            { x: 100, y: 300 }
        );

        assert.ok(distance < 0.001, `expected zero distance, got ${distance}`);
    });
});


