import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GraphPanelRendering } from '../../src/micro_otter/nodes/html/js/views/graph-panel-rendering.js';
import {
    DOCUMENTATION_AREA_BORDER_ALPHA,
    DOCUMENTATION_AREA_FILL_ALPHA,
    rgbaFromHex,
} from '../../src/micro_otter/nodes/html/js/data/documentation-area.js';

const VIEWPORT_SIZE = { width: 800, height: 600 };

/**
 * Recording 2D context: every drawing call lands in `operations` in order, together with the
 * style that was active when it happened.
 */
function createRecordingContext() {
    const operations = [];
    const ctx = {
        operations,
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        lineCap: 'butt',
        imageSmoothingEnabled: false,
        imageSmoothingQuality: '',
        textBaseline: '',
        save() {
            operations.push({ op: 'save' });
        },
        restore() {
            operations.push({ op: 'restore' });
        },
        beginPath() {
            operations.push({ op: 'beginPath' });
        },
        closePath() {
            operations.push({ op: 'closePath' });
        },
        moveTo(x, y) {
            operations.push({ op: 'moveTo', x, y });
        },
        lineTo(x, y) {
            operations.push({ op: 'lineTo', x, y });
        },
        quadraticCurveTo(cx, cy, x, y) {
            operations.push({ op: 'quadraticCurveTo', cx, cy, x, y });
        },
        stroke() {
            operations.push({
                op: 'stroke',
                strokeStyle: ctx.strokeStyle,
                lineWidth: ctx.lineWidth,
            });
        },
        fill() {
            operations.push({ op: 'fill', fillStyle: ctx.fillStyle });
        },
        fillRect() {
            operations.push({ op: 'fillRect', fillStyle: ctx.fillStyle });
        },
        clearRect() {
            operations.push({ op: 'clearRect' });
        },
        setTransform() {
            operations.push({ op: 'setTransform' });
        },
        scale() {},
        drawImage() {},
        measureText() {
            return { width: 0 };
        },
        fillText() {
            operations.push({ op: 'fillText' });
        },
        strokeRect() {
            operations.push({ op: 'strokeRect' });
        },
        arc() {
            operations.push({ op: 'arc' });
        },
        rect() {
            operations.push({ op: 'rect' });
        },
        setLineDash() {},
        translate() {},
        rotate() {},
    };
    return ctx;
}

function createRendering({ screenToWorld = (point) => point } = {}) {
    return new GraphPanelRendering({
        constants: {},
        viewport: { screenToWorld },
        connectionsUi: { drawConnections() {}, drawTempConnection() {} },
    });
}

function area(id, bounds, color = '#4a90d9') {
    return { id, title: id, markdown: '', color, bounds };
}

function opsOfType(ctx, type) {
    return ctx.operations.filter((entry) => entry.op === type);
}

describe('GraphPanelRendering.renderBackground', () => {
    it('draws the grid before the documentation areas', () => {
        const rendering = createRendering();
        const ctx = createRecordingContext();

        rendering.renderBackground(ctx, VIEWPORT_SIZE.width, VIEWPORT_SIZE.height, {
            showGrid: true,
            documentationAreas: [area('1', { x: 100, y: 100, width: 200, height: 150 })],
        });

        const firstStroke = ctx.operations.findIndex((entry) => entry.op === 'stroke');
        const firstFill = ctx.operations.findIndex((entry) => entry.op === 'fill');
        assert.ok(firstStroke !== -1, 'expected grid strokes');
        assert.ok(firstFill !== -1, 'expected an area fill');
        assert.ok(firstStroke < firstFill, 'grid must be drawn before the shading');
    });

    it('draws one fill and one stroke per visible area with the shared alphas', () => {
        const rendering = createRendering();
        const ctx = createRecordingContext();

        rendering.renderBackground(ctx, VIEWPORT_SIZE.width, VIEWPORT_SIZE.height, {
            showGrid: false,
            documentationAreas: [
                area('1', { x: 0, y: 0, width: 200, height: 150 }, '#4a90d9'),
                area('2', { x: 220, y: 0, width: 200, height: 150 }, '#FF8800'),
            ],
        });

        const fills = opsOfType(ctx, 'fill');
        const strokes = opsOfType(ctx, 'stroke');
        assert.equal(fills.length, 2);
        assert.equal(strokes.length, 2);
        assert.equal(fills[0].fillStyle, `rgba(74, 144, 217, ${DOCUMENTATION_AREA_FILL_ALPHA})`);
        assert.equal(fills[1].fillStyle, `rgba(255, 136, 0, ${DOCUMENTATION_AREA_FILL_ALPHA})`);
        assert.equal(
            strokes[0].strokeStyle,
            `rgba(74, 144, 217, ${DOCUMENTATION_AREA_BORDER_ALPHA})`
        );
        assert.equal(strokes[0].lineWidth, 1.5);
    });

    it('draws the active area with a thicker border only', () => {
        const rendering = createRendering();
        const ctx = createRecordingContext();

        rendering.renderBackground(ctx, VIEWPORT_SIZE.width, VIEWPORT_SIZE.height, {
            showGrid: false,
            documentationAreas: [
                area('1', { x: 0, y: 0, width: 200, height: 150 }),
                area('2', { x: 220, y: 0, width: 200, height: 150 }),
            ],
            activeAreaId: '2',
        });

        const strokes = opsOfType(ctx, 'stroke');
        assert.equal(strokes[0].lineWidth, 1.5);
        assert.equal(strokes[1].lineWidth, 2.5);
    });

    it('keeps every border thin when the active id matches nothing', () => {
        const rendering = createRendering();
        const ctx = createRecordingContext();

        rendering.renderBackground(ctx, VIEWPORT_SIZE.width, VIEWPORT_SIZE.height, {
            showGrid: false,
            documentationAreas: [area('1', { x: 0, y: 0, width: 200, height: 150 })],
            activeAreaId: 'missing',
        });

        assert.equal(opsOfType(ctx, 'stroke')[0].lineWidth, 1.5);
    });

    it('culls areas outside the viewport', () => {
        const rendering = createRendering();
        const ctx = createRecordingContext();

        rendering.renderBackground(ctx, VIEWPORT_SIZE.width, VIEWPORT_SIZE.height, {
            showGrid: false,
            documentationAreas: [
                area('visible', { x: 10, y: 10, width: 100, height: 100 }),
                area('offscreen', { x: 5000, y: 5000, width: 100, height: 100 }),
            ],
        });

        assert.equal(opsOfType(ctx, 'fill').length, 1);
        assert.equal(opsOfType(ctx, 'stroke').length, 1);
    });
});

describe('GraphPanelRendering.renderBackground edge cases', () => {
    it('draws nothing but the grid for an empty area list', () => {
        const rendering = createRendering();
        const ctx = createRecordingContext();

        rendering.renderBackground(ctx, VIEWPORT_SIZE.width, VIEWPORT_SIZE.height, {
            showGrid: true,
            documentationAreas: [],
        });

        assert.ok(opsOfType(ctx, 'stroke').length > 0, 'expected grid strokes');
        assert.equal(opsOfType(ctx, 'fill').length, 0);
    });

    it('draws neither grid nor areas when the grid is hidden and no area exists', () => {
        const rendering = createRendering();
        const ctx = createRecordingContext();

        rendering.renderBackground(ctx, VIEWPORT_SIZE.width, VIEWPORT_SIZE.height, {
            showGrid: false,
            documentationAreas: [],
        });

        assert.deepEqual(ctx.operations, []);
    });

    it('balances save/restore around the area pass', () => {
        const rendering = createRendering();
        const ctx = createRecordingContext();

        rendering.drawDocumentationAreas(ctx, [area('1', { x: 0, y: 0, width: 200, height: 150 })]);

        assert.equal(ctx.operations[0].op, 'save');
        assert.equal(ctx.operations[ctx.operations.length - 1].op, 'restore');
        assert.equal(opsOfType(ctx, 'save').length, opsOfType(ctx, 'restore').length);
    });

    it('traces a rounded rectangle without ctx.roundRect', () => {
        const rendering = createRendering();
        const ctx = createRecordingContext();

        rendering.drawDocumentationAreas(ctx, [area('1', { x: 0, y: 0, width: 200, height: 150 })]);

        assert.equal(opsOfType(ctx, 'quadraticCurveTo').length, 4);
        assert.equal(
            ctx.operations.some((entry) => entry.op === 'roundRect'),
            false
        );
    });

    it('leaves render() unchanged for single-canvas callers', () => {
        const rendering = createRendering();
        const ctx = createRecordingContext();

        rendering.render(ctx, VIEWPORT_SIZE.width, VIEWPORT_SIZE.height, {
            showGrid: false,
            nodeUiMap: new Map(),
            nodeOrderList: [],
            selectedNodeIds: new Set(),
        });

        assert.equal(opsOfType(ctx, 'fill').length, 0);
        assert.equal(opsOfType(ctx, 'stroke').length, 0);
    });
});

describe('rgbaFromHex', () => {
    it('formats integer channels with the requested alpha', () => {
        assert.equal(rgbaFromHex('#4a90d9', 0.16), 'rgba(74, 144, 217, 0.16)');
        assert.equal(rgbaFromHex('#ABC', 0.65), 'rgba(170, 187, 204, 0.65)');
    });

    it('normalizes invalid input and clamps the alpha', () => {
        assert.equal(rgbaFromHex('rgba(1,2,3,0.5)', 0.16), 'rgba(74, 144, 217, 0.16)');
        assert.equal(rgbaFromHex('#000000', 5), 'rgba(0, 0, 0, 1)');
        assert.equal(rgbaFromHex('#000000', -1), 'rgba(0, 0, 0, 0)');
    });
});
