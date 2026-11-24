import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createDomHarness } from '../helpers/dom-harness.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { NodeUi } from '../../src/micro_otter/nodes/html/js/nodes/node-ui.js';
import { drawNode } from '../../src/micro_otter/nodes/html/js/nodes/node-ui-rendering.js';
import { resetMdiIconIndexCache } from '../../src/micro_otter/nodes/html/js/data/mdi-icons.js';
import {
    MDI_CANVAS_FONT,
    resetMdiGlyphFontCache,
} from '../../src/micro_otter/nodes/html/js/nodes/mdi-glyph-font.js';

/**
 * Minimal MDI index standing in for the generated `vendor/mdi/icon-index.json`.
 */
const ICON_INDEX_FIXTURE = {
    version: '7.4.47',
    icons: {
        function: 'F0293',
    },
    aliases: {},
};

/** Glyph of `function` in the vendored webfont. */
const FUNCTION_GLYPH = String.fromCodePoint(0xf0293);

/**
 * Wait for the icon index and the webfont promises to settle.
 * @returns {Promise<void>} Resolves on the next macrotask.
 */
function flushPendingLoads() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Recording 2D context for `drawNode`: keeps every `fillText` with the font in effect, every
 * `drawImage` and every `fillRect` (so the 16×16 placeholder square is distinguishable).
 * @returns {object} Mock context with a `calls` log.
 */
function createRecordingContext() {
    const calls = [];
    return {
        calls,
        save() {},
        restore() {},
        beginPath() {},
        roundRect() {},
        fill() {},
        stroke() {},
        clip() {},
        moveTo() {},
        lineTo() {},
        translate() {},
        rotate() {},
        arc() {},
        scale() {},
        strokeRect() {},
        fillRect(x, y, width, height) {
            calls.push({ type: 'fillRect', x, y, width, height });
        },
        drawImage(...args) {
            calls.push({ type: 'drawImage', args });
        },
        fillText(text, x, y) {
            calls.push({ type: 'fillText', text, x, y, font: this.font });
        },
        measureText(text) {
            return { width: String(text).length * 7 };
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

const STYLE = {
    bodyColor: '#111',
    selectedBorderColor: '#fff',
    borderColor: '#999',
    headerColor: '#222',
    textColor: '#eee',
};

function createNodeData() {
    return {
        id: 'node-1',
        type: 'core.test',
        x: 10,
        y: 20,
        width: 180,
        height: 100,
        collapsed: false,
        controls: [],
        inputs: [],
        outputs: [],
    };
}

function createNodeUiStub() {
    return { getCurrentLocale: () => 'en', controlInstances: new Map() };
}

/**
 * Draw a node header with the given icon descriptor.
 * @param {object|null} icon - Icon descriptor for `drawNode`.
 * @returns {object} The recording context.
 */
function drawHeaderIcon(icon) {
    const ctx = createRecordingContext();
    drawNode(
        ctx,
        createNodeData(),
        STYLE,
        false,
        {},
        icon,
        () => [],
        () => [],
        createNodeUiStub()
    );
    return ctx;
}

describe('NodeUi MDI header icon', () => {
    let harness;
    let originalFetch;
    let originalImage;

    beforeEach(() => {
        harness = createDomHarness();
        resetMdiIconIndexCache();
        resetMdiGlyphFontCache();
        originalFetch = globalThis.fetch;
        originalImage = globalThis.Image;
        globalThis.Image = undefined;
        globalThis.fetch = async () => ({ ok: true, json: async () => ICON_INDEX_FIXTURE });
        document.fonts = { load: async () => [{}] };
    });

    afterEach(async () => {
        await flushPendingLoads();
        globalThis.fetch = originalFetch;
        globalThis.Image = originalImage;
        resetMdiIconIndexCache();
        resetMdiGlyphFontCache();
        harness.cleanup();
    });

    /**
     * Create a minimal graph with a single node carrying the given icon.
     * @param {string} icon - Node `icon` value.
     * @returns {{graph: NodeGraph, nodeId: string}} Graph and node id.
     */
    function createNode(icon) {
        const graph = new NodeGraph();
        graph.enableEvents();
        const node = graph.addNode({
            type: 'hass-sensor',
            x: 0,
            y: 0,
            width: 220,
            height: 180,
            title: 'Sensor',
            icon,
            controls: [],
            inputs: [],
            outputs: [],
            controlValues: {},
            inputDefaults: {},
        });

        return { graph, nodeId: node.id };
    }

    it('resolves an mdi: icon to a glyph and repaints once the index and font resolve', async () => {
        const { graph, nodeId } = createNode('mdi:function');
        const repaints = [];
        const nodeUi = new NodeUi(graph, nodeId, {
            onRepaintRequest: (requestedNodeId) => repaints.push(requestedNodeId),
        });

        assert.equal(nodeUi._iconGlyph, null, 'no glyph until the lazy resources resolve');

        await flushPendingLoads();

        assert.equal(nodeUi._iconGlyph, FUNCTION_GLYPH);
        assert.deepEqual(repaints, [nodeId]);
    });

    it('stores a foreign icon set as a text glyph', () => {
        const { graph, nodeId } = createNode('ph:function');
        const nodeUi = new NodeUi(graph, nodeId, { onRepaintRequest: () => {} });

        assert.equal(nodeUi._iconGlyph, 'ph:function');
        assert.equal(nodeUi._iconImage, null);
    });

    it('stores a text glyph synchronously', () => {
        const { graph, nodeId } = createNode('⚠️');
        const nodeUi = new NodeUi(graph, nodeId, { onRepaintRequest: () => {} });

        assert.equal(nodeUi._iconGlyph, '⚠️');
        assert.equal(nodeUi._iconImage, null);
    });

    it('loads a data: image icon through the image path', () => {
        class StubImage {
            constructor() {
                this.complete = false;
                this._src = '';
            }

            set src(value) {
                this._src = value;
            }

            get src() {
                return this._src;
            }
        }

        globalThis.Image = StubImage;
        const value = 'data:image/svg+xml;base64,PHN2Zy8+';
        const { graph, nodeId } = createNode(value);
        const nodeUi = new NodeUi(graph, nodeId, { onRepaintRequest: () => {} });

        assert.ok(nodeUi._iconImage, 'the image path creates an <img>');
        assert.equal(nodeUi._iconImage.src, value);
        assert.equal(nodeUi._iconGlyph, null);
    });
});

describe('drawNode header icon', () => {
    it('draws the placeholder square when the descriptor is null', () => {
        const ctx = drawHeaderIcon(null);

        assert.equal(ctx.calls.some((call) => call.type === 'drawImage'), false);
        assert.equal(
            ctx.calls.some(
                (call) => call.type === 'fillText' && String(call.font).includes('micro-otter-mdi')
            ),
            false,
            'no MDI glyph is painted without a descriptor'
        );
        assert.ok(
            ctx.calls.some(
                (call) => call.type === 'fillRect' && call.width === 16 && call.height === 16
            ),
            'the 16×16 placeholder square is drawn'
        );
    });

    it('paints the MDI glyph centred in the icon box', () => {
        const ctx = drawHeaderIcon({ image: null, mdiGlyph: FUNCTION_GLYPH });

        const glyph = ctx.calls.find(
            (call) => call.type === 'fillText' && String(call.font).includes('micro-otter-mdi')
        );
        assert.ok(glyph, 'the glyph is painted');
        assert.equal(glyph.text, FUNCTION_GLYPH);
        assert.equal(String(glyph.font), MDI_CANVAS_FONT);
        assert.equal(ctx.calls.some((call) => call.type === 'drawImage'), false);
    });

    it('draws the image when it is loaded', () => {
        const image = { complete: true };
        const ctx = drawHeaderIcon({ image, mdiGlyph: null });

        const draw = ctx.calls.find((call) => call.type === 'drawImage');
        assert.ok(draw, 'the loaded image is drawn');
        assert.equal(draw.args[0], image);
    });
});

