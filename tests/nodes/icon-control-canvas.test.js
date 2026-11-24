import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createDomHarness } from '../helpers/dom-harness.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { NodeUi } from '../../src/micro_otter/nodes/html/js/nodes/node-ui.js';
import { IconControlUi } from '../../src/micro_otter/nodes/html/js/nodes/controls/index.js';
import { resetMdiIconIndexCache } from '../../src/micro_otter/nodes/html/js/data/mdi-icons.js';

/**
 * Minimal MDI index standing in for the generated `vendor/mdi/icon-index.json`.
 */
const ICON_INDEX_FIXTURE = {
    version: '7.4.47',
    icons: {
        lightbulb: 'F0335',
        thermometer: 'F050F',
        'thermometer-lines': 'F10A2',
    },
    aliases: {
        temperature: 'thermometer',
    },
};

/** Glyph of `lightbulb` in the vendored webfont. */
const LIGHTBULB_GLYPH = String.fromCodePoint(0xf0335);

/** Control layout the node renderer passes for a single-row inline control. */
const LAYOUT = { x: 0, y: 0, width: 220, height: 18 };

/**
 * Recording 2D context: keeps every `fillText` together with the font in effect.
 * @returns {object} Mock context with a `calls` log.
 */
function createRecordingContext() {
    const calls = [];
    return {
        calls,
        font: '',
        fillStyle: '',
        strokeStyle: '',
        textAlign: 'left',
        textBaseline: 'alphabetic',
        lineWidth: 1,
        save() {
            calls.push({ type: 'save' });
        },
        restore() {
            calls.push({ type: 'restore' });
        },
        fillRect() {},
        strokeRect() {},
        fillText(text, x, y) {
            calls.push({ type: 'fillText', text, x, y, font: this.font });
        },
        measureText(text) {
            return { width: String(text).length * 7 };
        },
    };
}

/**
 * `fillText` calls that painted the MDI glyph rather than the value text.
 * @param {object} ctx - Recording context.
 * @returns {object[]} Glyph calls.
 */
function glyphCalls(ctx) {
    return ctx.calls.filter(
        (call) => call.type === 'fillText' && String(call.font).includes('micro-otter-mdi')
    );
}

/**
 * `fillText` call that painted the value text.
 * @param {object} ctx - Recording context.
 * @param {string} value - Expected text.
 * @returns {object|undefined} The call, if it was drawn.
 */
function valueTextCall(ctx, value) {
    return [...ctx.calls].reverse().find((call) => call.type === 'fillText' && call.text === value);
}

/**
 * Wait for the icon index and the webfont promises to settle.
 * @returns {Promise<void>} Resolves on the next macrotask.
 */
function flushPendingLoads() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Icon control canvas glyph', () => {
    let harness;
    let originalFetch;
    let repaintCount;

    beforeEach(() => {
        harness = createDomHarness();
        resetMdiIconIndexCache();
        repaintCount = 0;
        originalFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: true, json: async () => ICON_INDEX_FIXTURE });
    });

    afterEach(async () => {
        await flushPendingLoads();
        globalThis.fetch = originalFetch;
        resetMdiIconIndexCache();
        harness.cleanup();
    });

    /**
     * Create an icon control wired to a repaint-counting node UI stub.
     * @param {string} value - Initial control value.
     * @returns {object} Control and its node state.
     */
    function createControl(value) {
        const nodeData = { controlValues: { icon: value } };
        const control = new IconControlUi(
            { id: 'icon', type: 'icon', label: 'Icon', default: 'mdi:lightbulb' },
            nodeData,
            {
                requestRepaint: () => {
                    repaintCount += 1;
                },
            }
        );

        return { control, nodeData };
    }

    it('paints the glyph in front of the value and moves the text right', async () => {
        document.fonts = { load: async () => [{}] };

        const { control } = createControl('mdi:lightbulb');
        const firstPass = createRecordingContext();
        control.renderCanvas(firstPass, LAYOUT);

        // Nothing is known yet — no index, no font — so the box stays text-only.
        assert.equal(glyphCalls(firstPass).length, 0);

        await flushPendingLoads();

        const secondPass = createRecordingContext();
        control.renderCanvas(secondPass, LAYOUT);

        const glyph = glyphCalls(secondPass);
        assert.equal(glyph.length, 1);
        assert.equal(glyph[0].text, LIGHTBULB_GLYPH);
        assert.match(String(glyph[0].font), /^14px "micro-otter-mdi"$/);

        const text = valueTextCall(secondPass, 'mdi:lightbulb');
        assert.ok(text, 'the value text stays next to the glyph');
        assert.ok(
            text.x > glyph[0].x,
            'the text is shifted right by the width reserved for the glyph'
        );
    });

    it('keeps the plain text box for free text and foreign icon sets', async () => {
        document.fonts = { load: async () => [{}] };

        for (const value of ['therm', 'ph:lightbulb']) {
            const { control } = createControl(value);
            const ctx = createRecordingContext();
            control.renderCanvas(ctx, LAYOUT);
            await flushPendingLoads();
            control.renderCanvas(ctx, LAYOUT);

            assert.equal(glyphCalls(ctx).length, 0, `${value} must not paint a glyph`);
            assert.ok(valueTextCall(ctx, value), `${value} must keep its text`);
        }
    });

    it('does not request the icon index for a value of a foreign icon set', async () => {
        document.fonts = { load: async () => [{}] };
        let fetchCount = 0;
        globalThis.fetch = async () => {
            fetchCount += 1;
            return { ok: true, json: async () => ICON_INDEX_FIXTURE };
        };

        const { control } = createControl('ph:lightbulb');
        control.renderCanvas(createRecordingContext(), LAYOUT);
        await flushPendingLoads();

        assert.equal(fetchCount, 0);
    });

    it('repaints the node once the webfont arrives', async () => {
        document.fonts = { load: async () => [{}] };

        const { control } = createControl('mdi:lightbulb');
        control.renderCanvas(createRecordingContext(), LAYOUT);

        assert.equal(control._glyphFontStatus, 'loading');
        await flushPendingLoads();

        assert.equal(control._glyphFontStatus, 'ready');
        // Two lazy resources feed the glyph — index and webfont — and each one repaints the
        // node when it arrives.
        assert.equal(repaintCount, 2);
    });

    it('falls back to the text box when the webfont cannot be loaded', async () => {
        document.fonts = { load: async () => Promise.reject(new Error('offline')) };

        const { control } = createControl('mdi:lightbulb');
        control.renderCanvas(createRecordingContext(), LAYOUT);
        await flushPendingLoads();

        assert.equal(control._glyphFontStatus, 'failed');

        const ctx = createRecordingContext();
        control.renderCanvas(ctx, LAYOUT);
        assert.equal(glyphCalls(ctx).length, 0);
        assert.ok(valueTextCall(ctx, 'mdi:lightbulb'));
        // Only the index arrival repainted; the failed font must not loop the renderer.
        assert.equal(repaintCount, 1);
    });

    it('falls back to the text box without a FontFaceSet', () => {
        const { control } = createControl('mdi:lightbulb');
        control.renderCanvas(createRecordingContext(), LAYOUT);

        assert.equal(control._glyphFontStatus, 'failed');
    });
});

describe('NodeUi repaint requests', () => {
    let harness;

    beforeEach(() => {
        harness = createDomHarness();
    });

    afterEach(async () => {
        await flushPendingLoads();
        harness.cleanup();
    });

    /**
     * Create a minimal graph with a single node.
     * @param {object[]} controls - Visible controls of the node.
     * @param {object} controlValues - Initial control values.
     * @returns {{graph: NodeGraph, nodeId: string}} Graph and node id.
     */
    function createGraph(controls, controlValues) {
        const graph = new NodeGraph();
        graph.enableEvents();
        const node = graph.addNode({
            type: 'hass-sensor',
            x: 0,
            y: 0,
            width: 220,
            height: 180,
            title: 'Sensor',
            controls,
            inputs: [],
            outputs: [],
            controlValues,
            inputDefaults: {},
        });

        return { graph, nodeId: node.id };
    }

    it('forwards requestRepaint() to the graph view hook with the node id', () => {
        const { graph, nodeId } = createGraph(
            [{ id: 'icon', type: 'icon', label: 'Icon', default: 'mdi:lightbulb' }],
            { icon: 'mdi:lightbulb' }
        );

        const repaints = [];
        const nodeUi = new NodeUi(graph, nodeId, {
            onRepaintRequest: (requestedNodeId) => repaints.push(requestedNodeId),
        });

        nodeUi.requestRepaint();

        assert.deepEqual(repaints, [nodeId]);
    });

    it('ignores requestRepaint() without a repaint hook', () => {
        const { graph, nodeId } = createGraph([], {});
        const nodeUi = new NodeUi(graph, nodeId, {});

        assert.doesNotThrow(() => nodeUi.requestRepaint());
    });
});
