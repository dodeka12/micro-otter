import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { drawNode, drawConnectorLabel, computeConnectorPositions } from '../../src/micro_otter/nodes/html/js/nodes/node-ui-rendering.js';
import {
    CONNECTOR_HIGHLIGHT_LABEL_BACKGROUND_COLOR,
    CONNECTOR_HIGHLIGHT_LABEL_HEIGHT,
    CONNECTOR_HIGHLIGHT_LABEL_RADIUS,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js';
import { getDataTypeColor } from '../../src/micro_otter/nodes/html/js/nodes/data-type-colors.js';
import ConnectionsUi from '../../src/micro_otter/nodes/html/js/nodes/connections-ui.js';

const STYLE = {
    bodyColor: '#111111',
    selectedBorderColor: '#ffffff',
    borderColor: '#999999',
    headerColor: '#222222',
    textColor: '#eeeeee',
};

function createNodeRenderContext() {
    const strokeCalls = [];
    const fillCalls = [];
    const fillTextCalls = [];
    const roundRectCalls = [];

    return {
        strokeCalls,
        fillCalls,
        fillTextCalls,
        roundRectCalls,
        save() {},
        restore() {},
        beginPath() {},
        roundRect(x, y, width, height, radius) {
            roundRectCalls.push({ x, y, width, height, radius });
        },
        fill() {
            fillCalls.push({ style: this._fillStyle, alpha: this._globalAlpha });
        },
        clip() {},
        fillRect() {},
        drawImage() {},
        moveTo() {},
        lineTo() {},
        translate() {},
        rotate() {},
        scale() {},
        arc() {},
        stroke() {
            strokeCalls.push({
                style: this._strokeStyle,
                lineWidth: this._lineWidth,
            });
        },
        fillText(text, x, y) {
            fillTextCalls.push({ text, x, y, style: this._fillStyle, align: this._textAlign });
        },
        measureText() {
            return { width: 20 };
        },
        set fillStyle(value) {
            this._fillStyle = value;
        },
        get fillStyle() {
            return this._fillStyle;
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
        set globalAlpha(value) {
            this._globalAlpha = value;
        },
        get globalAlpha() {
            return this._globalAlpha;
        },
        set textAlign(value) {
            this._textAlign = value;
        },
        get textAlign() {
            return this._textAlign;
        },
        set textBaseline(value) {
            this._textBaseline = value;
        },
        get textBaseline() {
            return this._textBaseline;
        },
        set font(value) {
            this._font = value;
        },
        get font() {
            return this._font;
        },
        lineCap: 'round',
        lineJoin: 'round',
    };
}

function createConnectionContext() {
    const gradients = [];

    return {
        gradients,
        save() {},
        restore() {},
        beginPath() {},
        moveTo() {},
        bezierCurveTo() {},
        stroke() {},
        createLinearGradient() {
            const stops = [];
            gradients.push(stops);
            return {
                addColorStop(offset, color) {
                    stops.push({ offset, color });
                },
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

function createNodeUiMap() {
    return {
        controlInstances: new Map(),
        inputDefaultControlInstances: new Map(),
        getCurrentLocale: () => 'en',
        graph: {
            canConnect: () => ({ valid: true }),
        },
    };
}

function createNodeUiMapForGraph(graph) {
    return {
        controlInstances: new Map(),
        inputDefaultControlInstances: new Map(),
        getCurrentLocale: () => 'en',
        graph,
    };
}

function drawNodeForTest(nodeData, options = {}) {
    const ctx = createNodeRenderContext();
    drawNode(
        ctx,
        nodeData,
        STYLE,
        false,
        options,
        null,
        (node) => node.controls || [],
        (kind) => computeConnectorPositions(kind, nodeData, (node) => node.controls || []),
        options.nodeUi || createNodeUiMap()
    );
    return ctx;
}

describe('typed connector rendering', () => {
    const mathNode = {
        id: 'math-1',
        type: 'math',
        x: 20,
        y: 20,
        width: 180,
        height: 120,
        collapsed: false,
        controls: [],
        inputs: [
            { id: 'in0', name: 'A', allowedTypes: ['float'] },
            { id: 'in1', name: 'B', allowedTypes: ['float'] },
        ],
        outputs: [{ id: 'out0', name: 'Result', outputType: 'float' }],
    };

    const compareNode = {
        id: 'compare-1',
        type: 'compare',
        x: 260,
        y: 20,
        width: 180,
        height: 120,
        collapsed: false,
        controls: [],
        inputs: [
            { id: 'in0', name: 'A', allowedTypes: ['int', 'float', 'double'] },
            { id: 'in1', name: 'B', allowedTypes: ['int', 'float', 'double'] },
        ],
        outputs: [{ id: 'out0', name: 'Result', outputType: 'bool' }],
    };

    const logicNode = {
        id: 'logic-1',
        type: 'logic',
        x: 500,
        y: 20,
        width: 180,
        height: 120,
        collapsed: false,
        controls: [],
        inputs: [
            { id: 'in0', name: 'A', allowedTypes: ['bool'] },
            { id: 'in1', name: 'B', allowedTypes: ['bool'] },
        ],
        outputs: [{ id: 'out0', name: 'Result', outputType: 'bool' }],
    };

    it('renders typed connector colors for float and bool nodes', () => {
        const mathCtx = drawNodeForTest(mathNode);
        assert.ok(mathCtx.strokeCalls.some((call) => call.style === '#d8bf52'));

        const compareCtx = drawNodeForTest(compareNode);
        assert.ok(compareCtx.strokeCalls.some((call) => call.style === '#e7c66b'));
        assert.ok(compareCtx.strokeCalls.some((call) => call.style === '#7ba3d6'));

        const logicCtx = drawNodeForTest(logicNode);
        assert.ok(logicCtx.strokeCalls.some((call) => call.style === '#7ba3d6'));
    });

    it('renders connection gradients using source and target type colors', () => {
        const graph = {
            getConnections: () => [
                { fromNode: 'math-1', fromIndex: 0, toNode: 'compare-1', toIndex: 0 },
                { fromNode: 'compare-1', fromIndex: 0, toNode: 'logic-1', toIndex: 0 },
            ],
            getNode(nodeId) {
                if (nodeId === 'math-1') return mathNode;
                if (nodeId === 'compare-1') return compareNode;
                if (nodeId === 'logic-1') return logicNode;
                return null;
            },
            on: () => () => {},
        };

        const nodeUiMap = new Map([
            ['math-1', { getConnectorPosition: (kind) => (kind === 'output' ? { x: 200, y: 60 } : { x: 20, y: 60 }) }],
            ['compare-1', { getConnectorPosition: (kind) => (kind === 'output' ? { x: 440, y: 60 } : { x: 260, y: 60 }) }],
            ['logic-1', { getConnectorPosition: (kind) => (kind === 'output' ? { x: 680, y: 60 } : { x: 500, y: 60 }) }],
        ]);

        const connectionsUi = new ConnectionsUi({ graph });
        const ctx = createConnectionContext();

        connectionsUi.drawConnections(ctx, { nodeUiMap });

        assert.ok(
            ctx.gradients.some(
                (stops) => stops[0]?.color === '#d8bf52' && stops[1]?.color === '#e7c66b'
            ),
            'Expected float->int connection gradient based on first allowed input type'
        );
        assert.ok(
            ctx.gradients.some(
                (stops) => stops[0]?.color === '#7ba3d6' && stops[1]?.color === '#7ba3d6'
            ),
            'Expected bool->bool connection gradient'
        );
    });

    it('renders a soft transition stop for conversion-only connections', () => {
        const boolSourceNode = {
            id: 'bool-source-1',
            outputs: [{ id: 'out0', outputType: 'bool' }],
        };
        const floatTargetNode = {
            id: 'float-target-1',
            inputs: [{ id: 'in0', allowedTypes: ['float'] }],
        };

        const graph = {
            getConnections: () => [
                {
                    fromNode: 'bool-source-1',
                    fromIndex: 0,
                    toNode: 'float-target-1',
                    toIndex: 0,
                },
            ],
            getNode(nodeId) {
                if (nodeId === 'bool-source-1') return boolSourceNode;
                if (nodeId === 'float-target-1') return floatTargetNode;
                return null;
            },
            on: () => () => {},
        };

        const nodeUiMap = new Map([
            ['bool-source-1', { getConnectorPosition: (kind) => (kind === 'output' ? { x: 200, y: 60 } : { x: 20, y: 60 }) }],
            ['float-target-1', { getConnectorPosition: (kind) => (kind === 'output' ? { x: 440, y: 60 } : { x: 260, y: 60 }) }],
        ]);

        const connectionsUi = new ConnectionsUi({ graph });
        const ctx = createConnectionContext();

        connectionsUi.drawConnections(ctx, { nodeUiMap });

        assert.ok(
            ctx.gradients.some(
                (stops) =>
                    stops.length === 3 &&
                    stops[0]?.color === '#7ba3d6' &&
                    stops[1]?.offset === 0.55 &&
                    stops[2]?.color === '#d8bf52'
            ),
            'Expected conversion edge to include a soft middle transition stop'
        );
    });

        it('uses typed start connector color for temporary drag connections', () => {
            const graph = {
                getConnections: () => [],
                getNode(nodeId) {
                    if (nodeId === 'math-1') return mathNode;
                    if (nodeId === 'compare-1') return compareNode;
                    return null;
                },
                on: () => () => {},
            };

            const connectionsUi = new ConnectionsUi({ graph });
            const ctx = createConnectionContext();

            connectionsUi.drawTempConnection(
                ctx,
                {
                    start: { x: 200, y: 60 },
                    end: { x: 300, y: 60 },
                    startKind: 'output',
                    startNodeId: 'math-1',
                    startIndex: 0,
                },
                'full'
            );

            assert.ok(
                ctx.gradients.some(
                    (stops) => stops[0]?.color === '#d8bf52' && stops[1]?.color === '#d8bf52'
                ),
                'Expected temp connection gradient to use typed output color from drag start connector'
            );
        });

    it('highlights only type-compatible targets while dragging', () => {
        const graph = {
            canConnect(fromNodeId, fromIndex, toNodeId, toIndex) {
                if (
                    fromNodeId === 'math-1' &&
                    fromIndex === 0 &&
                    toNodeId === 'compare-1' &&
                    toIndex === 0
                ) {
                    return { valid: true };
                }
                return { valid: false };
            },
        };

        const draggingConnection = {
            startKind: 'output',
            startNodeId: 'math-1',
            startIndex: 0,
        };

        const compareCtx = drawNodeForTest(compareNode, {
            draggingConnection,
            nodeUi: {
                controlInstances: new Map(),
                inputDefaultControlInstances: new Map(),
                getCurrentLocale: () => 'en',
                graph,
            },
        });
        assert.ok(
            compareCtx.strokeCalls.some(
                (call) => call.style === '#e7c66b' && call.lineWidth === 3
            ),
            'Expected compatible compare input highlight'
        );

        const logicCtx = drawNodeForTest(logicNode, {
            draggingConnection,
            nodeUi: {
                controlInstances: new Map(),
                inputDefaultControlInstances: new Map(),
                getCurrentLocale: () => 'en',
                graph,
            },
        });
        assert.equal(
            logicCtx.strokeCalls.some((call) => call.style === '#7ba3d6' && call.lineWidth === 3),
            false,
            'Expected incompatible logic inputs to remain unhighlighted'
        );
    });

    it('highlights a compatible input exactly like a compatible output', () => {
        const graph = {
            canConnect(fromNodeId, fromIndex, toNodeId, toIndex) {
                return {
                    valid:
                        fromNodeId === 'math-1' &&
                        fromIndex === 0 &&
                        toNodeId === 'compare-1' &&
                        toIndex === 0,
                };
            },
        };

        const compareCtx = drawNodeForTest(compareNode, {
            draggingConnection: {
                startKind: 'output',
                startNodeId: 'math-1',
                startIndex: 0,
            },
            nodeUi: createNodeUiMapForGraph(graph),
        });

        assert.ok(
            compareCtx.strokeCalls.some((call) => call.style === '#e7c66b' && call.lineWidth === 3),
            'Expected the input socket to use the shared 1.5x highlight stroke'
        );
        assert.equal(
            compareCtx.fillCalls.some((call) => call.alpha === 0.2),
            false,
            'Expected no extra translucent halo rectangle around a highlighted input'
        );
        assert.ok(
            compareCtx.strokeCalls.some((call) => call.style === '#e7c66b' && call.lineWidth === 1),
            'Expected the input label backdrop to be bordered in the data-type colour'
        );
        assert.equal(
            compareCtx.fillTextCalls.find((call) => call.text === 'A')?.style,
            STYLE.textColor,
            'Expected the highlighted input label to keep the node text colour'
        );
    });

    it('keeps a highlighted output label readable on a dark backdrop', () => {
        const graph = {
            canConnect(fromNodeId, fromIndex, toNodeId, toIndex) {
                return {
                    valid:
                        fromNodeId === 'math-1' &&
                        fromIndex === 0 &&
                        toNodeId === 'compare-1' &&
                        toIndex === 0,
                };
            },
        };

        const ctx = drawNodeForTest(mathNode, {
            draggingConnection: {
                startKind: 'input',
                startNodeId: 'compare-1',
                startIndex: 0,
            },
            nodeUi: createNodeUiMapForGraph(graph),
        });

        assert.ok(
            ctx.strokeCalls.some((call) => call.style === '#d8bf52' && call.lineWidth === 6),
            'Expected the output plug to use the shared 1.5x highlight stroke'
        );
        assert.equal(
            ctx.fillCalls.some((call) => call.alpha === 0.2),
            false,
            'Expected no extra translucent halo around a highlighted output'
        );
        assert.equal(
            ctx.fillTextCalls.find((call) => call.text === 'Result')?.style,
            STYLE.textColor,
            'Expected the highlighted output label to keep the node text colour'
        );
        assert.equal(
            ctx.fillCalls.filter(
                (call) => call.style === CONNECTOR_HIGHLIGHT_LABEL_BACKGROUND_COLOR
            ).length,
            1,
            'Expected one dark backdrop behind the highlighted output label'
        );
        assert.ok(
            ctx.strokeCalls.some((call) => call.style === '#d8bf52' && call.lineWidth === 1),
            'Expected the output label backdrop to be bordered in the data-type colour'
        );
    });

    it('keeps any-typed output labels readable while highlighting them', () => {
        const webNode = {
            id: 'web-1',
            type: 'web',
            x: 20,
            y: 20,
            width: 180,
            height: 120,
            collapsed: false,
            controls: [],
            inputs: [{ id: 'in0', name: 'In', allowedTypes: ['string'] }],
            outputs: [{ id: 'out0', name: 'Page', outputType: 'any' }],
        };

        const graph = {
            canConnect(fromNodeId, fromIndex, toNodeId, toIndex) {
                return {
                    valid:
                        fromNodeId === 'web-1' &&
                        fromIndex === 0 &&
                        toNodeId === 'consumer-1' &&
                        toIndex === 0,
                };
            },
        };

        const ctx = drawNodeForTest(webNode, {
            draggingConnection: {
                startKind: 'input',
                startNodeId: 'consumer-1',
                startIndex: 0,
            },
            nodeUi: createNodeUiMapForGraph(graph),
        });

        assert.equal(
            ctx.fillTextCalls.find((call) => call.text === 'Page')?.style,
            STYLE.textColor,
            'Expected the any-typed label text to stay readable instead of turning #e3e3e3'
        );
        assert.ok(
            ctx.fillCalls.some((call) => call.style === CONNECTOR_HIGHLIGHT_LABEL_BACKGROUND_COLOR),
            'Expected a dark backdrop behind the any-typed output label'
        );
        assert.ok(
            ctx.strokeCalls.some((call) => call.style === '#e3e3e3' && call.lineWidth === 1),
            'Expected the any data-type colour on the backdrop border'
        );
    });
});

describe('connector label backdrop', () => {
    it('wraps a left-aligned highlighted label in a dark, type-bordered pill', () => {
        const ctx = createNodeRenderContext();

        drawConnectorLabel(ctx, {
            x: 100,
            y: 50,
            align: 'left',
            text: 'A',
            textColor: '#eeeeee',
            highlightColor: '#e3e3e3',
        });

        assert.deepEqual(ctx.roundRectCalls, [
            { x: 96, y: 42, width: 28, height: 16, radius: 4 },
        ]);
        assert.deepEqual(ctx.fillCalls, [
            { style: CONNECTOR_HIGHLIGHT_LABEL_BACKGROUND_COLOR, alpha: undefined },
        ]);
        assert.deepEqual(ctx.strokeCalls, [{ style: '#e3e3e3', lineWidth: 1 }]);
        assert.deepEqual(ctx.fillTextCalls, [
            { text: 'A', x: 100, y: 50, style: '#eeeeee', align: 'left' },
        ]);
    });

    it('mirrors the pill for right-aligned labels', () => {
        const ctx = createNodeRenderContext();

        drawConnectorLabel(ctx, {
            x: 100,
            y: 50,
            align: 'right',
            text: 'Result',
            textColor: '#eeeeee',
            highlightColor: '#d8bf52',
        });

        assert.deepEqual(ctx.roundRectCalls, [
            { x: 76, y: 42, width: 28, height: 16, radius: 4 },
        ]);
        assert.deepEqual(ctx.strokeCalls, [{ style: '#d8bf52', lineWidth: 1 }]);
        assert.deepEqual(ctx.fillTextCalls, [
            { text: 'Result', x: 100, y: 50, style: '#eeeeee', align: 'right' },
        ]);
    });

    it('draws no backdrop when the label is not highlighted', () => {
        const ctx = createNodeRenderContext();

        drawConnectorLabel(ctx, {
            x: 100,
            y: 50,
            align: 'left',
            text: 'A',
            textColor: '#eeeeee',
        });

        assert.deepEqual(ctx.roundRectCalls, []);
        assert.deepEqual(ctx.fillCalls, []);
        assert.deepEqual(ctx.strokeCalls, []);
        assert.deepEqual(ctx.fillTextCalls, [
            { text: 'A', x: 100, y: 50, style: '#eeeeee', align: 'left' },
        ]);
    });

    it('draws no backdrop for an empty label', () => {
        const ctx = createNodeRenderContext();

        drawConnectorLabel(ctx, {
            x: 100,
            y: 50,
            align: 'left',
            text: '',
            textColor: '#eeeeee',
            highlightColor: '#e3e3e3',
        });

        assert.deepEqual(ctx.roundRectCalls, []);
        assert.deepEqual(ctx.fillCalls, []);
        assert.deepEqual(ctx.strokeCalls, []);
    });
});

describe('input default control highlight', () => {
    const BG = CONNECTOR_HIGHLIGHT_LABEL_BACKGROUND_COLOR;
    const LABEL_PADDING = 4;
    const TYPE_COLOR = getDataTypeColor('string');

    const webNode = {
        id: 'web-1',
        type: 'web',
        x: 20,
        y: 20,
        width: 240,
        height: 120,
        collapsed: false,
        controls: [],
        inputs: [{ id: 'in0', name: 'URL', allowedTypes: ['string'], defaultControl: { type: 'text' } }],
        outputs: [],
    };

    const dragFromOutput = { startKind: 'output', startNodeId: 'src-1', startIndex: 0 };

    /**
     * Default-control stub that records the pill ordering around `renderCanvas()`.
     * @param {object|null} [labelRect] - Bounds to return; omit for a representative rect,
     *   pass `null` to simulate a control that reports no label.
     * @returns {object} Stub control instance.
     */
    function createControlStub(labelRect) {
        return {
            seenBounds: null,
            fillsAtRender: -1,
            strokesAtRender: -1,
            fillTextIndexAtRender: -1,
            renderCount: 0,
            getCanvasLabelBounds(_ctx, bounds) {
                this.seenBounds = { ...bounds };
                if (labelRect === undefined) {
                    return { x: bounds.x, y: bounds.y + 2, width: 20, height: 22 };
                }
                return labelRect;
            },
            renderCanvas(ctx, bounds) {
                this.renderCount += 1;
                this.fillsAtRender = ctx.fillCalls.length;
                this.strokesAtRender = ctx.strokeCalls.length;
                this.fillTextIndexAtRender = ctx.fillTextCalls.length;
                ctx.fillText('URL', bounds.x, bounds.y);
            },
        };
    }

    /**
     * Draw the web node with a default-control stub.
     * @param {object} options - Stub, graph and drawing overrides.
     * @returns {{ ctx: object, stub: object|undefined }} Drawing context and stub.
     */
    function drawWebNode(options = {}) {
        const stub = 'stub' in options ? options.stub : createControlStub();
        const instances = stub ? new Map([['in0', stub]]) : new Map();

        const ctx = drawNodeForTest(webNode, {
            ...options.drawOptions,
            nodeUi: {
                controlInstances: new Map(),
                inputDefaultControlInstances: instances,
                getCurrentLocale: () => 'en',
                graph: options.graph || {
                    canConnect: () => ({ valid: true }),
                    getConnections: () => [],
                },
            },
        });

        return { ctx, stub };
    }

    /**
     * Dark pill fills recorded by the drawing context.
     * @param {object} ctx - Recording context.
     * @returns {object[]} Matching fill calls.
     */
    function pillFills(ctx) {
        return ctx.fillCalls.filter((call) => call.style === BG);
    }

    /**
     * Pill outline rectangles (height identifies them, socket outlines differ).
     * @param {object} ctx - Recording context.
     * @returns {object[]} Matching roundRect calls.
     */
    function pillRects(ctx) {
        return ctx.roundRectCalls.filter(
            (call) => call.height === CONNECTOR_HIGHLIGHT_LABEL_HEIGHT
        );
    }

    it('paints the pill behind an allowed input default control', () => {
        const { ctx, stub } = drawWebNode({ drawOptions: { draggingConnection: dragFromOutput } });

        assert.equal(stub.renderCount, 1, 'the default control is still rendered');

        const rects = pillRects(ctx);
        assert.equal(rects.length, 1, 'exactly one pill');
        assert.deepEqual(rects[0], {
            x: stub.seenBounds.x - LABEL_PADDING,
            y: stub.seenBounds.y + 2 + 22 / 2 - CONNECTOR_HIGHLIGHT_LABEL_HEIGHT / 2,
            width: 20 + LABEL_PADDING * 2,
            height: CONNECTOR_HIGHLIGHT_LABEL_HEIGHT,
            radius: CONNECTOR_HIGHLIGHT_LABEL_RADIUS,
        });

        assert.equal(pillFills(ctx).length, 1, 'one dark pill fill');
        assert.equal(
            ctx.strokeCalls.filter((call) => call.lineWidth === 1).length,
            1,
            'exactly one hairline border stroke'
        );
        assert.ok(
            ctx.strokeCalls.some((call) => call.style === TYPE_COLOR && call.lineWidth === 1),
            'the pill border uses the input data-type colour'
        );
    });

    it('draws the pill before the control paints its own label', () => {
        const { ctx, stub } = drawWebNode({ drawOptions: { draggingConnection: dragFromOutput } });

        const pillFillIndex = ctx.fillCalls.findIndex((call) => call.style === BG);
        assert.ok(pillFillIndex >= 0);
        assert.ok(
            pillFillIndex < stub.fillsAtRender,
            'the pill must be filled before renderCanvas() runs'
        );
        assert.ok(
            ctx.strokeCalls.findIndex((call) => call.lineWidth === 1) < stub.strokesAtRender,
            'the pill must be stroked before renderCanvas() runs'
        );

        const labelCall = ctx.fillTextCalls[stub.fillTextIndexAtRender];
        assert.equal(labelCall?.text, 'URL', 'the control draws its label after the pill');
    });

    it('highlights a hovered input the same way as a dragged-to one', () => {
        const { ctx, stub } = drawWebNode({
            drawOptions: {
                hoverConnector: { nodeId: 'web-1', type: 'input', index: 0 },
            },
        });

        assert.equal(stub.renderCount, 1);
        assert.equal(pillFills(ctx).length, 1, 'hover paints the same pill');
        assert.ok(
            ctx.strokeCalls.some((call) => call.style === TYPE_COLOR && call.lineWidth === 1),
            'hover border uses the data-type colour'
        );
    });

    it('leaves an incompatible input unpilled', () => {
        const { ctx, stub } = drawWebNode({
            drawOptions: { draggingConnection: dragFromOutput },
            graph: {
                canConnect: () => ({ valid: false }),
                getConnections: () => [],
            },
        });

        assert.equal(stub.renderCount, 1);
        assert.deepEqual(pillFills(ctx), [], 'no pill for an incompatible target');
        assert.deepEqual(pillRects(ctx), []);
        assert.ok(
            ctx.strokeCalls.some((call) => call.style === TYPE_COLOR && call.lineWidth === 2),
            'the socket keeps its normal stroke'
        );
    });

    it('skips the pill for controls without label bounds', () => {
        const stub = {
            renderCount: 0,
            renderCanvas() {
                this.renderCount += 1;
            },
        };
        const { ctx } = drawWebNode({ stub, drawOptions: { draggingConnection: dragFromOutput } });

        assert.equal(stub.renderCount, 1, 'the control still renders');
        assert.deepEqual(pillFills(ctx), []);
        assert.deepEqual(pillRects(ctx), []);
    });

    it('skips the pill when the control reports no usable label rect', () => {
        for (const labelRect of [null, { x: 0, y: 0, width: 0, height: 22 }]) {
            const stub = createControlStub(labelRect);
            const { ctx } = drawWebNode({
                stub,
                drawOptions: { draggingConnection: dragFromOutput },
            });

            assert.deepEqual(pillFills(ctx), [], `no pill for ${JSON.stringify(labelRect)}`);
            assert.deepEqual(pillRects(ctx), [], `no rect for ${JSON.stringify(labelRect)}`);
        }
    });

    it('clamps an oversized label rect to the control width', () => {
        const stub = createControlStub({ x: 0, y: 0, width: 5000, height: 22 });
        const { ctx } = drawWebNode({
            stub,
            drawOptions: { draggingConnection: dragFromOutput },
        });

        const rects = pillRects(ctx);
        assert.equal(rects.length, 1);
        assert.equal(rects[0].width, stub.seenBounds.width, 'pill cannot exceed the control');
    });

    it('paints the same pill for a connected input label', () => {
        const { ctx, stub } = drawWebNode({
            drawOptions: { draggingConnection: dragFromOutput },
            graph: {
                canConnect: () => ({ valid: true }),
                getConnections: () => [
                    { fromNode: 'src-1', fromIndex: 0, toNode: 'web-1', toIndex: 0 },
                ],
            },
        });

        assert.equal(stub.renderCount, 0, 'a connected input renders its label, not the control');
        assert.equal(pillFills(ctx).length, 1, 'the label path paints the same dark pill');
        assert.ok(
            ctx.strokeCalls.some((call) => call.style === TYPE_COLOR && call.lineWidth === 1),
            'the label pill uses the same border'
        );
        assert.equal(
            ctx.fillTextCalls.find((call) => call.text === 'URL')?.style,
            STYLE.textColor,
            'the label keeps the node text colour'
        );
    });
});

