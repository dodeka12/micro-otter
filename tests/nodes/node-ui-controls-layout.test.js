// Copyright (c) 2026 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Test: shared control column layout.
 *
 * Covers the control label metrics, the label resolution rule, the per-type value floors,
 * the truncation primitive, the shared label column, the control-driven content minimum,
 * the controls/connector spacing and the separator. Runs headless, so label widths use the
 * deterministic per-character estimate.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import * as constants from '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js';
import {
    CONTROL_HEIGHT,
    CONTROL_LABEL_CHAR_WIDTH_ESTIMATE,
    CONTROL_LABEL_FONT,
    CONTROL_LABEL_MARGIN,
    CONTROL_SPACING,
    CONTROL_VALUE_MIN_WIDTH,
    CONTROL_VALUE_MIN_WIDTH_BY_TYPE,
    CONNECTOR_RADIUS,
    CONNECTOR_ROW_INSET,
    CONNECTOR_SPACING,
    CONTROLS_CONNECTOR_GAP,
    NODE_BODY_PADDING,
    NODE_HEADER_HEIGHT,
    NODE_HEADER_ICON_INSET,
    NODE_HEADER_ICON_SIZE,
    NODE_HEADER_TITLE_FONT,
    NODE_HEADER_TITLE_PADDING,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js';
import {
    calculateNodeHeight,
    computeControlColumnLayout,
    computeControlsMinWidth,
    computeNodeMinContentWidth,
    fitTextToWidth,
    getControlGeometry,
    getControlsConnectorGap,
    getControlsSectionHeight,
    getControlValueMinWidth,
    measureControlLabelColumnWidth,
    measureControlLabelWidth,
    resolveControlLabelText,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js';
import {
    computeConnectorPositions,
    drawNode,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-rendering.js';
import { NodeUi } from '../../src/micro_otter/nodes/html/js/nodes/node-ui.js';
import {
    CheckboxControlUi,
    ColorControlUi,
    IconControlUi,
    NodeDropdownControlUi,
    NumberControlUi,
    SliderControlUi,
    TextControlUi,
} from '../../src/micro_otter/nodes/html/js/nodes/controls/index.js';

/**
 * Deterministic headless label width.
 * @param {string} text - Label text.
 * @returns {number} Estimated width in pixels.
 */
function estimate(text) {
    return text.length * CONTROL_LABEL_CHAR_WIDTH_ESTIMATE;
}

/**
 * Create a plain control definition.
 * @param {object} overrides - Definition overrides.
 * @returns {object} Control definition.
 */
function control(overrides = {}) {
    return { id: 'ctrl', type: 'number', label: 'Ctrl', ...overrides };
}

/**
 * Minimal measuring context that reports one pixel per character.
 * @returns {object} Measuring context with a call log.
 */
function createMeasureContext() {
    const calls = [];
    return {
        calls,
        measureText(text) {
            calls.push(text);
            return { width: String(text).length };
        },
    };
}

/**
 * Recording 2D context for render-path assertions.
 * @returns {object} Mock context with a `calls` log.
 */
function createRecordingContext() {
    const calls = [];
    return {
        calls,
        saveCount: 0,
        restoreCount: 0,
        save() {
            this.saveCount += 1;
        },
        restore() {
            this.restoreCount += 1;
        },
        beginPath() {},
        roundRect() {},
        closePath() {},
        fill() {},
        stroke() {},
        clip() {},
        drawImage() {},
        translate() {},
        rotate() {},
        scale() {},
        setLineDash() {},
        quadraticCurveTo() {},
        bezierCurveTo() {},
        moveTo(x, y) {
            calls.push({ type: 'moveTo', x, y });
        },
        lineTo(x, y) {
            calls.push({ type: 'lineTo', x, y });
        },
        fillRect(x, y, width, height) {
            calls.push({ type: 'fillRect', x, y, width, height });
        },
        strokeRect(x, y, width, height) {
            calls.push({ type: 'strokeRect', x, y, width, height });
        },
        arc(x, y, radius) {
            calls.push({ type: 'arc', x, y, radius });
        },
        fillText(text, x, y) {
            calls.push({ type: 'fillText', text, x, y });
        },
        measureText(text) {
            return { width: String(text).length * CONTROL_LABEL_CHAR_WIDTH_ESTIMATE };
        },
        set font(value) {
            this._font = value;
        },
        get font() {
            return this._font;
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
        lineCap: 'round',
        lineJoin: 'round',
    };
}

const STYLE = {
    bodyColor: '#111',
    headerColor: '#222',
    borderColor: '#999',
    selectedBorderColor: '#fff',
    textColor: '#eee',
};

/**
 * Create a node data record.
 * @param {object} overrides - Field overrides.
 * @returns {object} Node data.
 */
function createNode(overrides = {}) {
    return {
        id: 'node-1',
        type: 'test.node',
        x: 100,
        y: 80,
        width: 260,
        height: 180,
        title: 'Test Node',
        collapsed: false,
        controls: [],
        inputs: [],
        outputs: [],
        controlValues: {},
        setPosition(x, y) {
            this.x = x;
            this.y = y;
        },
        ...overrides,
    };
}

/**
 * Create a node graph stub around one node.
 * @param {object} node - Node data.
 * @returns {object} Graph stub with an update log.
 */
function createGraph(node) {
    const updateCalls = [];

    return {
        updateCalls,
        getNode(nodeId) {
            return nodeId === node.id ? node : null;
        },
        getConnections() {
            return [];
        },
        getConnectionsForNode() {
            return [];
        },
        updateNodePosition(nodeId, x, y) {
            if (nodeId === node.id) {
                node.setPosition(x, y);
            }
        },
        updateNode(nodeId, patch) {
            updateCalls.push({ nodeId, patch });
            if (nodeId === node.id) {
                Object.assign(node, patch);
            }
        },
    };
}

/**
 * Instantiate the control UI that belongs to a definition.
 * @param {object} definition - Control definition.
 * @param {string} locale - Locale reported by the node UI stub.
 * @returns {object} Control UI instance.
 */
function createControlInstance(definition, locale = 'en') {
    const nodeData = { controlValues: { [definition.id]: definition.default } };
    const nodeUi = { getCurrentLocale: () => locale };
    const classes = {
        number: NumberControlUi,
        text: TextControlUi,
        dropdown: NodeDropdownControlUi,
        checkbox: CheckboxControlUi,
        slider: SliderControlUi,
        color: ColorControlUi,
        icon: IconControlUi,
    };
    const ControlClass = classes[definition.type];
    assert.ok(ControlClass, `unsupported control type ${definition.type}`);
    return new ControlClass(definition, nodeData, nodeUi);
}

/**
 * Build a NodeUi-like render context for `drawNode()`.
 * @param {object[]} controls - Control definitions.
 * @param {string} locale - Locale reported to the renderer.
 * @returns {object} Render context.
 */
function createRenderContext(controls, locale = 'en') {
    const controlInstances = new Map();
    for (const definition of controls) {
        controlInstances.set(definition.id, createControlInstance(definition, locale));
    }
    return { controlInstances, getCurrentLocale: () => locale };
}

/**
 * Filter recorded `fillRect` calls by height.
 * @param {object} ctx - Recording context.
 * @param {number} height - Expected rectangle height.
 * @returns {object[]} Matching calls.
 */
function valueRectsOfHeight(ctx, height) {
    return ctx.calls.filter((call) => call.type === 'fillRect' && call.height === height);
}

describe('control layout constants', () => {
    it('exposes the control label metrics', () => {
        assert.match(CONTROL_LABEL_FONT, /^500 11px /);
        assert.equal(CONTROL_LABEL_CHAR_WIDTH_ESTIMATE, 7);
        assert.equal(CONTROL_LABEL_MARGIN, 4);
        assert.equal(CONNECTOR_ROW_INSET, 16);
    });

    it('documents a frozen per-type value floor table', () => {
        assert.equal(CONTROL_VALUE_MIN_WIDTH, 80);
        assert.ok(Object.isFrozen(CONTROL_VALUE_MIN_WIDTH_BY_TYPE));
        assert.deepEqual(Object.keys(CONTROL_VALUE_MIN_WIDTH_BY_TYPE).sort(), [
            'checkbox',
            'color',
            'dropdown',
            'icon',
            'number',
            'slider',
            'text',
        ]);
        assert.deepEqual(
            { ...CONTROL_VALUE_MIN_WIDTH_BY_TYPE },
            {
                number: 80,
                dropdown: 96,
                text: 96,
                icon: 96,
                checkbox: 24,
                color: 40,
                slider: 120,
            }
        );
    });

    it('no longer exports the dead label width constant or geometry type', () => {
        assert.equal('CONTROL_LABEL_WIDTH' in constants, false);
        assert.equal('NodeUiGeometryConfig' in constants, false);
    });

    it('exposes the header icon and title metrics', () => {
        assert.equal(NODE_HEADER_ICON_SIZE, 16);
        assert.equal(NODE_HEADER_ICON_INSET, 6);
        assert.equal(NODE_HEADER_TITLE_PADDING, 4);
        assert.match(NODE_HEADER_TITLE_FONT, /^600 12px /);
    });
});

describe('fitTextToWidth()', () => {
    it('returns short text unchanged', () => {
        const ctx = createMeasureContext();
        const fitted = fitTextToWidth(ctx, 'Count', 80);

        assert.equal(fitted.text, 'Count');
        assert.equal(fitted.width, 5);
    });

    it('ellipsises long text to the longest fitting prefix', () => {
        const ctx = createMeasureContext();
        const text = 'Color Model Selection';
        const fitted = fitTextToWidth(ctx, text, 10);

        assert.ok(fitted.text.endsWith('…'));
        assert.ok(fitted.width <= 10);

        let expected = '';
        for (let length = 0; length < text.length; length += 1) {
            const candidate = text.slice(0, length) + '…';
            if (candidate.length <= 10) {
                expected = candidate;
            }
        }

        assert.equal(fitted.text, expected);
    });

    it('returns an empty result for unusable inputs', () => {
        const ctx = createMeasureContext();

        assert.deepEqual(fitTextToWidth(ctx, '', 40), { text: '', width: 0 });
        assert.deepEqual(fitTextToWidth(ctx, 'Count', 0), { text: '', width: 0 });
        assert.deepEqual(fitTextToWidth(ctx, 'Count', -5), { text: '', width: 0 });
        assert.deepEqual(fitTextToWidth(null, 'Count', 40), { text: '', width: 0 });
        assert.deepEqual(fitTextToWidth(ctx, 'Count', 0.5), { text: '', width: 0 });
    });

    it('never measures a candidate longer than the input text', () => {
        const ctx = createMeasureContext();
        const text = 'Envelope Follower';

        fitTextToWidth(ctx, text, 6);

        for (const candidate of ctx.calls) {
            assert.ok(candidate.length <= text.length, `"${candidate}" is longer than the input`);
        }
    });
});

describe('measureControlLabelColumnWidth()', () => {
    it('measures the widest inline label', () => {
        const controls = [
            control({ id: 'count', label: 'Count' }),
            control({ id: 'color', type: 'dropdown', label: 'Color Model' }),
            control({ id: 'pin', type: 'dropdown', label: 'Data Pin' }),
        ];

        assert.equal(measureControlLabelColumnWidth(controls), estimate('Color Model'));
    });

    it('ignores stacked controls', () => {
        const controls = [
            control({ id: 'count', label: 'Count' }),
            control({ id: 'stacked', label: 'A Very Long Stacked Label', layout: 'stacked' }),
        ];

        assert.equal(measureControlLabelColumnWidth(controls), estimate('Count'));
    });

    it('returns zero without inline controls', () => {
        assert.equal(measureControlLabelColumnWidth(null), 0);
        assert.equal(measureControlLabelColumnWidth([]), 0);
        assert.equal(measureControlLabelColumnWidth([control({ id: 's', layout: 'stacked' })]), 0);
    });

    it('grows with a longer translation', () => {
        const controls = [control({ label: { en: 'Color', de: 'Farbauswahl' } })];

        assert.ok(
            measureControlLabelColumnWidth(controls, 'de') >
                measureControlLabelColumnWidth(controls, 'en')
        );
    });
});

describe('control label resolution in the control base class', () => {
    /**
     * Create a number control bound to a locale-aware node UI stub.
     * @param {object} controlData - Control definition.
     * @param {string} locale - Locale reported by the node UI stub.
     * @returns {NumberControlUi} Control instance.
     */
    function createControl(controlData, locale) {
        return new NumberControlUi(
            { type: 'number', default: 1, ...controlData },
            { controlValues: {} },
            { getCurrentLocale: () => locale }
        );
    }

    it('resolves string, localized and fallback labels', () => {
        assert.equal(
            createControl({ id: 'gain', label: 'Gain' }, 'en')._getLocalizedLabel(),
            'Gain'
        );

        const localized = { id: 'color', label: { en: 'Color', de: 'Farbe' } };
        assert.equal(createControl(localized, 'de')._getLocalizedLabel(), 'Farbe');
        assert.equal(createControl(localized, 'fr')._getLocalizedLabel(), 'Color');

        assert.equal(
            createControl({ id: 'color', label: { fr: 'Couleur' } }, 'de')._getLocalizedLabel(),
            'Couleur'
        );
        assert.equal(createControl({ id: 'gain' }, 'en')._getLocalizedLabel(), 'gain');
    });
});

describe('control label measuring canvas', () => {
    const originalDocument = globalThis.document;
    const measureCalls = [];

    after(() => {
        if (originalDocument === undefined) {
            delete globalThis.document;
        } else {
            globalThis.document = originalDocument;
        }
    });

    it('uses the control label font on its own measuring context', async () => {
        const stubContext = {
            font: '',
            measureText(text) {
                measureCalls.push(text);
                return { width: String(text).length * 3 };
            },
        };

        globalThis.document = {
            createElement() {
                return { getContext: () => stubContext };
            },
        };

        // Fresh module instance, so the lazily created measuring context picks up the stub.
        const fresh =
            await import('../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js?canvas-stub=1');

        assert.equal(fresh.measureControlLabelWidth('Count'), 15);
        assert.equal(stubContext.font, CONTROL_LABEL_FONT);

        const callsAfterFirstMeasure = measureCalls.length;
        assert.equal(fresh.measureControlLabelWidth('Count'), 15);
        assert.equal(measureCalls.length, callsAfterFirstMeasure, 'second call must hit the cache');
    });
});

describe('measureControlLabelWidth()', () => {
    it('returns zero for missing or empty labels', () => {
        assert.equal(measureControlLabelWidth(''), 0);
        assert.equal(measureControlLabelWidth(null), 0);
        assert.equal(measureControlLabelWidth(undefined), 0);
    });

    it('falls back to the deterministic character estimate without a canvas', () => {
        assert.equal(measureControlLabelWidth('Count'), estimate('Count'));
        assert.equal(measureControlLabelWidth('Color Model'), estimate('Color Model'));
    });

    it('measures longer labels wider and memoises the result', () => {
        const short = measureControlLabelWidth('Data Pin');
        const long = measureControlLabelWidth('Color Model');

        assert.ok(long > short);
        assert.equal(measureControlLabelWidth('Data Pin'), short);
        assert.equal(measureControlLabelWidth('Color Model'), long);
    });
});

describe('resolveControlLabelText()', () => {
    it('returns a string label verbatim', () => {
        assert.equal(resolveControlLabelText({ id: 'gain', label: 'Gain' }), 'Gain');
    });

    it('resolves localized labels through the active locale', () => {
        assert.equal(
            resolveControlLabelText({ label: { en: 'Color', de: 'Farbe' } }, 'de'),
            'Farbe'
        );
        assert.equal(
            resolveControlLabelText({ label: { en: 'Color', de: 'Farbe' } }, 'fr'),
            'Color'
        );
        assert.equal(resolveControlLabelText({ label: { fr: 'Couleur' } }, 'de'), 'Couleur');
    });

    it('falls back to the control id', () => {
        assert.equal(resolveControlLabelText({ id: 'gain' }), 'gain');
        assert.equal(resolveControlLabelText({ id: 'gain', label: '   ' }), 'gain');
    });

    it('returns an empty string when nothing usable exists', () => {
        assert.equal(resolveControlLabelText(null), '');
        assert.equal(resolveControlLabelText(undefined), '');
        assert.equal(resolveControlLabelText({}), '');
    });
});

describe('getControlValueMinWidth()', () => {
    it('returns the documented floor for every known type', () => {
        for (const [type, floor] of Object.entries(CONTROL_VALUE_MIN_WIDTH_BY_TYPE)) {
            assert.equal(getControlValueMinWidth({ id: 'c', type }), floor);
        }
    });

    it('falls back to the default floor for unknown types and missing controls', () => {
        assert.equal(getControlValueMinWidth({ id: 'c', type: 'unsupported' }), 80);
        assert.equal(getControlValueMinWidth({ id: 'c' }), 80);
        assert.equal(getControlValueMinWidth(null), 80);
    });
});

describe('computeControlColumnLayout()', () => {
    const inlineControls = [
        control({ id: 'count', label: 'Count' }),
        control({ id: 'color', type: 'dropdown', label: 'Color Model' }),
        control({ id: 'pin', type: 'dropdown', label: 'Data Pin' }),
    ];

    it('shares one label and one value column across inline controls', () => {
        const column = computeControlColumnLayout({
            x: 100,
            width: 260,
            visibleControls: inlineControls,
        });
        const expectedLabelWidth = estimate('Color Model');

        assert.equal(column.inset, 16);
        assert.equal(column.availableWidth, 260 - 32);
        assert.equal(column.labelWidth, expectedLabelWidth);
        assert.equal(column.labelX, 100 + 16);
        assert.equal(column.valueX, 100 + 16 + expectedLabelWidth + CONTROL_LABEL_MARGIN);
        assert.equal(column.valueWidth, 228 - expectedLabelWidth - CONTROL_LABEL_MARGIN);
    });

    it('excludes stacked controls from the label column', () => {
        const column = computeControlColumnLayout({
            x: 0,
            width: 300,
            visibleControls: [
                control({ id: 'count', label: 'Count' }),
                control({ id: 'stacked', label: 'A Much Longer Stacked Label', layout: 'stacked' }),
            ],
        });

        assert.equal(column.labelWidth, estimate('Count'));
    });

    it('clamps the label column so the value floor still fits', () => {
        const column = computeControlColumnLayout({
            x: 0,
            width: 120,
            visibleControls: inlineControls,
        });

        assert.equal(column.availableWidth, 88);
        assert.equal(column.labelWidth, 4);
        assert.equal(column.valueWidth, CONTROL_VALUE_MIN_WIDTH);
    });

    it('returns zeros for degenerate widths and missing controls', () => {
        const column = computeControlColumnLayout({ x: 10, width: 0 });

        assert.equal(column.availableWidth, 0);
        assert.equal(column.labelWidth, 0);
        assert.equal(column.valueWidth, 0);
        assert.equal(column.labelX, 26);

        const invalid = computeControlColumnLayout({ x: Number.NaN, width: Number.NaN });
        assert.equal(invalid.availableWidth, 0);
        assert.equal(invalid.labelWidth, 0);
        assert.equal(invalid.valueWidth, 0);
    });

    it('grows the column when the active locale has longer labels', () => {
        const localized = [control({ id: 'color', label: { en: 'Color', de: 'Farbauswahl' } })];

        const english = computeControlColumnLayout({
            x: 0,
            width: 400,
            visibleControls: localized,
        });
        const german = computeControlColumnLayout({
            x: 0,
            width: 400,
            visibleControls: localized,
            locale: 'de',
        });

        assert.ok(german.labelWidth > english.labelWidth);
    });
});

describe('getControlGeometry() with a shared label column', () => {
    it('reproduces the legacy inline bounds without a label column', () => {
        const geometry = getControlGeometry(control(), { x: 12, y: 40, width: 200 });

        assert.equal(geometry.valueBounds.x, 12);
        assert.equal(geometry.valueBounds.width, 200);
        assert.equal(geometry.fullBounds.x, 12);
    });

    it('offsets the value bounds by the shared column and margin', () => {
        const geometry = getControlGeometry(control(), {
            x: 12,
            y: 40,
            width: 200,
            labelWidth: 60,
        });

        assert.equal(geometry.valueBounds.x, 12 + 60 + CONTROL_LABEL_MARGIN);
        assert.equal(geometry.valueBounds.width, 200 - 64);
        assert.equal(geometry.fullBounds.width, 200);
    });

    it('clamps an over-wide column to a zero-width value area', () => {
        const geometry = getControlGeometry(control(), { x: 0, y: 0, width: 30, labelWidth: 60 });

        assert.equal(geometry.valueBounds.width, 0);
    });

    it('ignores the label column for stacked controls', () => {
        const geometry = getControlGeometry(control({ layout: 'stacked' }), {
            x: 12,
            y: 40,
            width: 200,
            labelWidth: 60,
        });

        assert.equal(geometry.valueBounds.x, 12);
        assert.equal(geometry.valueBounds.width, 200);
    });
});

describe('drawControls() through the shared column', () => {
    const controls = [
        { id: 'count', type: 'number', label: 'Count', default: 4 },
        {
            id: 'model',
            type: 'dropdown',
            label: 'Color Model',
            default: 'rgb',
            options: [{ value: 'rgb', label: 'RGB' }],
        },
        { id: 'pin', type: 'text', label: 'Data Pin', default: 'gpio1' },
    ];

    it('draws every inline value in the same column at the connector inset', () => {
        const node = createNode({ controls });
        const nodeUi = createRenderContext(controls);
        const ctx = createRecordingContext();

        drawNode(
            ctx,
            node,
            STYLE,
            false,
            {},
            null,
            () => controls,
            () => [],
            nodeUi
        );

        const column = computeControlColumnLayout({
            x: node.x,
            width: node.width,
            visibleControls: controls,
        });
        const valueRects = valueRectsOfHeight(ctx, CONTROL_HEIGHT);

        assert.equal(valueRects.length, 3);
        for (const rect of valueRects) {
            assert.equal(rect.x, column.valueX);
            assert.equal(rect.width, column.valueWidth);
        }
        assert.equal(
            column.valueX,
            node.x + CONNECTOR_ROW_INSET + column.labelWidth + CONTROL_LABEL_MARGIN
        );
        assert.ok(valueRects[0].x > node.x + 6, 'controls must not start at the body padding');
    });

    it('draws the resolved labels untruncated on a wide node', () => {
        const node = createNode({ controls });
        const nodeUi = createRenderContext(controls);
        const ctx = createRecordingContext();

        drawNode(
            ctx,
            node,
            STYLE,
            false,
            {},
            null,
            () => controls,
            () => [],
            nodeUi
        );

        const texts = ctx.calls.filter((call) => call.type === 'fillText').map((call) => call.text);
        assert.ok(texts.includes('Count'));
        assert.ok(texts.includes('Color Model'));
        assert.ok(texts.includes('Data Pin'));
    });
});

describe('control hit-testing parity', () => {
    const controls = [
        { id: 'count', type: 'number', label: 'Count', default: 4 },
        {
            id: 'model',
            type: 'dropdown',
            label: 'Color Model',
            default: 'rgb',
            options: [{ value: 'rgb', label: 'RGB' }],
        },
        { id: 'pin', type: 'text', label: 'Data Pin', default: 'gpio1' },
    ];

    function drawNodeUi(width = 260) {
        const node = createNode({
            width,
            controls,
            controlValues: { count: 4, model: 'rgb', pin: 'gpio1' },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);
        const ctx = createRecordingContext();

        nodeUi.draw(ctx);

        return { node, graph, nodeUi, ctx };
    }

    it('returns the drawn value rectangle for every control type', () => {
        const { node, nodeUi, ctx } = drawNodeUi();
        const column = nodeUi.getControlColumnLayout();
        const valueRects = valueRectsOfHeight(ctx, CONTROL_HEIGHT);

        assert.ok(column);
        assert.equal(valueRects.length, 3);

        for (const rect of valueRects) {
            assert.equal(rect.x, column.valueX);
            assert.equal(rect.width, column.valueWidth);

            const hit = nodeUi.hitTestControl({
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
            });

            assert.ok(hit, 'the value column must be hit-testable');
            assert.deepEqual(hit.bounds, {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
            });
        }

        const firstRect = valueRects[0];
        const labelHit = nodeUi.hitTestControl({
            x: node.x + CONNECTOR_ROW_INSET + 2,
            y: firstRect.y + firstRect.height / 2,
        });
        assert.equal(labelHit?.controlId, 'count', 'the whole row stays clickable');

        const missHit = nodeUi.hitTestControl({ x: node.x + 40, y: firstRect.y - 10 });
        assert.equal(missHit, null, 'a point above the row must not hit');
    });
});

describe('control value layout via the shared column', () => {
    const defaults = {
        number: { default: 4 },
        text: { default: 'value' },
        dropdown: { default: 'a', options: [{ value: 'a', label: 'A' }] },
        checkbox: { default: true },
        slider: { default: 50, constraints: { min: 0, max: 100 } },
        color: { default: '#11223344' },
    };

    function definitionFor(type, overrides = {}) {
        return { id: `${type}-control`, type, label: 'Count', ...defaults[type], ...overrides };
    }

    it('starts every value column at the same offset', () => {
        for (const type of Object.keys(defaults)) {
            const instance = createControlInstance(definitionFor(type));
            const ctx = createRecordingContext();
            const valueLayout = instance._renderLabelAndGetValueLayout(
                ctx,
                10,
                20,
                200,
                CONTROL_HEIGHT,
                60
            );

            assert.equal(valueLayout.x, 10 + 60 + CONTROL_LABEL_MARGIN, `${type} value x`);
            assert.equal(valueLayout.width, 200 - 64, `${type} value width`);
        }
    });

    it('draws the value inside the shared column for every type', () => {
        const expectations = {
            number: { x: 74, width: 136 },
            text: { x: 74, width: 136 },
            dropdown: { x: 74, width: 136 },
            slider: { x: 74, width: 76 },
            checkbox: { x: 78, width: 16 },
            // The color control starts with the first checkerboard tile behind the swatch.
            color: { x: 78, width: 4 },
        };

        for (const [type, expected] of Object.entries(expectations)) {
            const instance = createControlInstance(definitionFor(type));
            const ctx = createRecordingContext();

            instance.renderCanvas(ctx, {
                x: 10,
                y: 20,
                width: 200,
                height: CONTROL_HEIGHT,
                labelWidth: 60,
            });

            const firstRect = ctx.calls.find((call) => call.type === 'fillRect');
            assert.ok(firstRect, `${type} must draw a value area`);
            assert.equal(firstRect.x, expected.x, `${type} value x`);
            assert.equal(firstRect.width, expected.width, `${type} value width`);
        }
    });

    it('ellipsises a label that does not fit the column', () => {
        const definition = definitionFor('number', { label: 'Color Model' });
        const instance = createControlInstance(definition);
        const ctx = createRecordingContext();

        instance.renderCanvas(ctx, {
            x: 10,
            y: 20,
            width: 200,
            height: CONTROL_HEIGHT,
            labelWidth: 20,
        });

        const labelCall = ctx.calls.find((call) => call.type === 'fillText');
        assert.ok(labelCall.text.endsWith('…'));
        assert.ok(labelCall.text.length * CONTROL_LABEL_CHAR_WIDTH_ESTIMATE <= 20);
    });

    it('keeps the intrinsic layout when no column is supplied', () => {
        const instance = createControlInstance(definitionFor('number'));
        const ctx = createRecordingContext();
        const valueLayout = instance._renderLabelAndGetValueLayout(
            ctx,
            10,
            20,
            200,
            CONTROL_HEIGHT
        );

        assert.equal(valueLayout.x, 10 + estimate('Count') + CONTROL_LABEL_MARGIN);
        assert.equal(valueLayout.width, 200 - estimate('Count') - CONTROL_LABEL_MARGIN);
    });
});

describe('intrinsically sized controls inside the shared column', () => {
    it('keeps the checkbox box at 16 px beside the value column', () => {
        const controls = [{ id: 'enabled', type: 'checkbox', label: 'Enabled', default: true }];
        const node = createNode({ width: 260, controls });
        const column = computeControlColumnLayout({
            x: node.x,
            width: node.width,
            visibleControls: controls,
        });
        const instance = createControlInstance(controls[0]);
        const ctx = createRecordingContext();

        instance.renderCanvas(ctx, {
            x: node.x + CONNECTOR_ROW_INSET,
            y: node.y + 30,
            width: column.availableWidth,
            height: CONTROL_HEIGHT,
            labelWidth: column.labelWidth,
        });

        const box = ctx.calls.find((call) => call.type === 'fillRect');
        assert.equal(box.x, column.valueX + 4);
        assert.equal(box.width, 16);
        assert.equal(box.height, 16);
        assert.equal(instance.getLayout().width, 24);
    });

    it('anchors the color caption next to the swatch and omits it when it does not fit', () => {
        const controls = [{ id: 'color', type: 'color', label: 'Color', default: '#11223344' }];
        const wide = computeControlColumnLayout({ x: 0, width: 420, visibleControls: controls });
        const narrow = computeControlColumnLayout({ x: 0, width: 140, visibleControls: controls });
        const instance = createControlInstance(controls[0]);
        const swatchSize = CONTROL_HEIGHT - 4;

        const wideCtx = createRecordingContext();
        instance.renderCanvas(wideCtx, {
            x: CONNECTOR_ROW_INSET,
            y: 30,
            width: wide.availableWidth,
            height: CONTROL_HEIGHT,
            labelWidth: wide.labelWidth,
        });

        const swatchX = wide.valueX + 4;
        const captions = wideCtx.calls.filter(
            (call) => call.type === 'fillText' && String(call.text).startsWith('α')
        );
        assert.equal(captions.length, 1);
        assert.equal(captions[0].x, swatchX + swatchSize + 6);

        const narrowCtx = createRecordingContext();
        instance.renderCanvas(narrowCtx, {
            x: CONNECTOR_ROW_INSET,
            y: 30,
            width: narrow.availableWidth,
            height: CONTROL_HEIGHT,
            labelWidth: narrow.labelWidth,
        });

        for (const call of narrowCtx.calls.filter((entry) => entry.type === 'fillText')) {
            assert.ok(
                call.x <= narrow.valueX + narrow.valueWidth,
                'caption must stay in the column'
            );
        }
        assert.equal(instance.getLayout().width, 180);
    });

    it('lays out and draws the icon control exactly like the text control', () => {
        const textDefinition = control({
            id: 'icon',
            type: 'text',
            label: 'Icon',
            default: 'mdi:thermometer',
        });
        const iconDefinition = control({
            id: 'icon',
            type: 'icon',
            label: 'Icon',
            default: 'mdi:thermometer',
        });
        const column = computeControlColumnLayout({
            x: 0,
            width: 420,
            visibleControls: [textDefinition],
        });
        const layout = {
            x: CONNECTOR_ROW_INSET,
            y: 30,
            width: column.availableWidth,
            height: CONTROL_HEIGHT,
            labelWidth: column.labelWidth,
        };
        const textInstance = createControlInstance(textDefinition);
        const iconInstance = createControlInstance(iconDefinition);
        const textCtx = createRecordingContext();
        const iconCtx = createRecordingContext();

        textInstance.renderCanvas(textCtx, layout);
        assert.doesNotThrow(() => iconInstance.renderCanvas(iconCtx, layout));

        assert.deepEqual(iconInstance.getLayout(), textInstance.getLayout());
        assert.deepEqual(iconCtx.calls, textCtx.calls);
        assert.deepEqual(
            computeControlColumnLayout({ x: 0, width: 420, visibleControls: [iconDefinition] }),
            column
        );
    });
});

describe('NodeUi.getControlColumnLayout()', () => {
    const controls = [
        { id: 'count', type: 'number', label: 'Count', default: 4 },
        { id: 'model', type: 'dropdown', label: 'Color Model', default: 'rgb', options: [] },
    ];

    it('returns null without node data', () => {
        const nodeUi = new NodeUi(null, 'missing-node');

        assert.equal(nodeUi.getControlColumnLayout(), null);
    });

    it('matches the pure helper for the same inputs', () => {
        const node = createNode({ controls, controlValues: { count: 4, model: 'rgb' } });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);

        const expected = computeControlColumnLayout({
            x: node.x,
            width: node.width,
            visibleControls: controls,
        });

        assert.deepEqual(nodeUi.getControlColumnLayout(), expected);
    });

    it('measures the labels of the active locale', () => {
        const localized = [
            { id: 'color', type: 'number', label: { en: 'Color', de: 'Farbauswahl' }, default: 1 },
        ];
        const node = createNode({ controls: localized, controlValues: { color: 1 } });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, { i18nService: { currentLocale: 'de' } });

        const column = nodeUi.getControlColumnLayout();

        assert.ok(column);
        assert.equal(column.labelWidth, estimate('Farbauswahl'));
    });
});

describe('computeControlsMinWidth()', () => {
    it('measures the inline label column plus the widest value floor', () => {
        const controls = [
            control({ id: 'count', label: 'Count' }),
            control({ id: 'model', type: 'dropdown', label: 'Color Model' }),
            control({ id: 'pin', type: 'dropdown', label: 'Data Pin' }),
            control({ id: 'order', type: 'dropdown', label: 'Color Order' }),
        ];

        assert.equal(
            computeControlsMinWidth(controls).inline,
            32 + estimate('Color Order') + 4 + 96
        );
    });

    it('uses the checkbox floor for a single checkbox', () => {
        const requirement = computeControlsMinWidth([
            control({ id: 'enabled', type: 'checkbox', label: 'Enabled' }),
        ]);

        assert.equal(requirement.inline, 32 + estimate('Enabled') + 4 + 24);
        assert.equal(requirement.stacked, 0);
        assert.equal(requirement.combined, requirement.inline);
    });

    it('gives stacked controls a full-width row', () => {
        const requirement = computeControlsMinWidth([
            control({ id: 'slider', type: 'slider', label: 'Gain', layout: 'stacked' }),
        ]);

        assert.equal(requirement.inline, 0);
        assert.equal(requirement.stacked, 32 + 120);
    });

    it('returns zeros without controls and grows with a longer translation', () => {
        assert.deepEqual(computeControlsMinWidth(null), { inline: 0, stacked: 0, combined: 0 });
        assert.deepEqual(computeControlsMinWidth([]), { inline: 0, stacked: 0, combined: 0 });

        const localized = [control({ id: 'color', label: { en: 'Color', de: 'Farbauswahl' } })];
        assert.ok(
            computeControlsMinWidth(localized, 'de').inline >
                computeControlsMinWidth(localized, 'en').inline
        );
    });
});

describe('computeNodeMinContentWidth() with controls', () => {
    const inlineControls = [
        control({ id: 'count', label: 'Count' }),
        control({ id: 'model', type: 'dropdown', label: 'Color Model' }),
        control({ id: 'pin', type: 'dropdown', label: 'Data Pin' }),
        control({ id: 'order', type: 'dropdown', label: 'Color Order' }),
    ];

    it('sizes a node that only has controls', () => {
        const node = createNode({ controls: inlineControls });

        assert.equal(
            computeNodeMinContentWidth(node),
            computeControlsMinWidth(inlineControls).combined
        );
        assert.ok(computeNodeMinContentWidth(node) > 0);
    });

    it('takes the wider of connector rows and controls', () => {
        const narrowRowNode = createNode({
            controls: [control({ id: 'enabled', type: 'checkbox', label: 'Enabled' })],
            inputs: [{ id: 'in0', name: 'In' }],
            outputs: [{ id: 'out0', name: 'Out' }],
        });
        const expectedRowWidth = 16 + estimate('In') + 6 + estimate('Out') + 16;
        assert.equal(
            computeNodeMinContentWidth(narrowRowNode),
            Math.max(expectedRowWidth, computeControlsMinWidth(narrowRowNode.controls).combined)
        );

        const wideRowNode = createNode({
            controls: [control({ id: 'enabled', type: 'checkbox', label: 'Enabled' })],
            inputs: [{ id: 'in0', name: 'A very long input label' }],
            outputs: [{ id: 'out0', name: 'A very long output label' }],
        });
        assert.ok(
            computeNodeMinContentWidth(wideRowNode) >
                computeControlsMinWidth(wideRowNode.controls).combined
        );
    });

    it('uses the stacked formula for stacked-only nodes', () => {
        const controls = [
            control({ id: 'slider', type: 'slider', label: 'Gain', layout: 'stacked' }),
        ];
        const node = createNode({ controls });

        assert.equal(computeNodeMinContentWidth(node), 32 + 120);
    });

    it('keeps a checkbox-only node below the default 140 px width', () => {
        const node = createNode({
            width: 140,
            controls: [control({ id: 'enabled', type: 'checkbox', label: 'On' })],
        });

        assert.ok(computeNodeMinContentWidth(node) < 140);
    });

    it('returns zero for collapsed nodes and nodes without content', () => {
        assert.equal(computeNodeMinContentWidth(createNode({ collapsed: true })), 0);
        assert.equal(computeNodeMinContentWidth(createNode()), 0);
        assert.equal(computeNodeMinContentWidth(null), 0);
    });
});

describe('controls/connector spacing', () => {
    const controls = [
        { id: 'count', type: 'number', label: 'Count', default: 4 },
        { id: 'pin', type: 'text', label: 'Data Pin', default: 'gpio1' },
    ];
    const inputs = [
        { id: 'in0', name: 'In' },
        { id: 'in1', name: 'In B' },
    ];
    const outputs = [
        { id: 'out0', name: 'Out' },
        { id: 'out1', name: 'Out B' },
    ];

    it('documents the pitch and the section gap', () => {
        assert.equal(CONNECTOR_SPACING, 21);
        assert.equal(CONTROLS_CONNECTOR_GAP, 12);
    });

    it('only reports a gap when both sections are visible', () => {
        assert.equal(getControlsConnectorGap(controls, 2), 12);
        assert.equal(getControlsConnectorGap([], 2), 0);
        assert.equal(getControlsConnectorGap(controls, 0), 0);
        assert.equal(getControlsConnectorGap(null, 0), 0);
    });

    it('budgets the gap into the node height', () => {
        const data = createNode({ controls, inputs, outputs });
        const controlsSection = getControlsSectionHeight(controls);

        assert.equal(
            calculateNodeHeight(
                data,
                (node) => node.controls,
                (node) => node.inputs,
                (node) => node.outputs
            ),
            NODE_HEADER_HEIGHT +
                NODE_BODY_PADDING +
                controlsSection +
                CONTROLS_CONNECTOR_GAP +
                2 * CONNECTOR_SPACING +
                NODE_BODY_PADDING
        );

        const withoutConnectors = createNode({ controls });
        assert.equal(
            calculateNodeHeight(
                withoutConnectors,
                (node) => node.controls,
                (node) => node.inputs,
                (node) => node.outputs
            ),
            NODE_HEADER_HEIGHT + NODE_BODY_PADDING + controlsSection + NODE_BODY_PADDING
        );
    });

    it('starts the connector block after the gap', () => {
        const data = createNode({ controls, inputs, outputs });
        const controlsSection = getControlsSectionHeight(controls);
        const positions = computeConnectorPositions('input', data, () => controls);

        assert.equal(positions.length, 2);
        assert.equal(
            positions[0].y,
            data.y +
                NODE_HEADER_HEIGHT +
                NODE_BODY_PADDING +
                controlsSection +
                CONTROLS_CONNECTOR_GAP +
                CONNECTOR_RADIUS
        );
        assert.equal(positions[1].y - positions[0].y, CONNECTOR_SPACING);

        const withoutControls = createNode({ inputs, outputs });
        const plainPositions = computeConnectorPositions('input', withoutControls, () => []);
        assert.equal(
            plainPositions[0].y,
            withoutControls.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING + CONNECTOR_RADIUS
        );

        const collapsed = createNode({ controls, inputs, outputs, collapsed: true });
        const collapsedPositions = computeConnectorPositions('input', collapsed, () => controls);
        assert.equal(collapsedPositions[0].y, collapsed.y + NODE_HEADER_HEIGHT / 2);
    });

    it('keeps at least 6 px between the last control and the first connector row', () => {
        const node = createNode({ controls, inputs, outputs });
        const controlsSection = getControlsSectionHeight(controls);
        // The section height includes one trailing CONTROL_SPACING after the last control.
        const lastControlBottom =
            node.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING + controlsSection - CONTROL_SPACING;
        const firstConnectorTop =
            computeConnectorPositions('input', node, () => controls)[0].y - CONTROL_HEIGHT / 2;

        assert.ok(
            firstConnectorTop - lastControlBottom >= 6,
            `clearance ${firstConnectorTop - lastControlBottom} px is too small`
        );
        assert.equal(
            firstConnectorTop - lastControlBottom,
            CONTROL_SPACING + CONTROLS_CONNECTOR_GAP + CONNECTOR_RADIUS - CONTROL_HEIGHT / 2
        );
    });

    it('keeps input default control rendering and hit-testing aligned', () => {
        const controls = [{ id: 'count', type: 'number', label: 'Count', default: 4 }];
        const node = createNode({
            controls,
            controlValues: { count: 4 },
            inputs: [
                {
                    id: 'in0',
                    name: 'Value',
                    defaultControl: { id: 'in0', type: 'number', label: 'Value', default: 3 },
                },
            ],
            outputs: [{ id: 'out0', name: 'Result' }],
            inputDefaults: { in0: 3 },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);

        const renderedBounds = [];
        nodeUi.inputDefaultControlInstances.set('in0', {
            getLayout: () => ({ height: CONTROL_HEIGHT }),
            renderCanvas: (_ctx, bounds) => renderedBounds.push({ ...bounds }),
        });

        nodeUi.draw(createRecordingContext());

        assert.equal(renderedBounds.length, 1, 'expected one input default control');
        const rendered = renderedBounds[0];
        const hit = nodeUi.hitTestControl({
            x: rendered.x + rendered.width / 2,
            y: rendered.y + rendered.height / 2,
        });

        assert.equal(hit?.controlId, 'in0');
        assert.deepEqual(hit?.bounds, rendered);
    });
});

describe('controls/connector separator', () => {
    const controls = [
        { id: 'count', type: 'number', label: 'Count', default: 4 },
        { id: 'pin', type: 'text', label: 'Data Pin', default: 'gpio1' },
    ];
    const inputs = [
        { id: 'in0', name: 'In' },
        { id: 'in1', name: 'In B' },
    ];
    const outputs = [{ id: 'out0', name: 'Out' }];

    function separatorYOf(node) {
        return (
            node.y +
            NODE_HEADER_HEIGHT +
            NODE_BODY_PADDING +
            getControlsSectionHeight(controls) +
            CONTROLS_CONNECTOR_GAP / 2
        );
    }

    function renderNode(overrides = {}, visibleControls = controls) {
        const node = createNode({ controls: visibleControls, inputs, outputs, ...overrides });
        const nodeUi = createRenderContext(visibleControls);
        const ctx = createRecordingContext();
        const positions = computeConnectorPositions('input', node, () => visibleControls);

        drawNode(
            ctx,
            node,
            STYLE,
            false,
            {},
            null,
            () => visibleControls,
            (kind) => (kind === 'input' ? positions : []),
            nodeUi
        );

        return { node, ctx, positions };
    }

    function separatorSegment(ctx, node) {
        const expectedY = Math.round(separatorYOf(node)) + 0.5;
        return ctx.calls.filter(
            (call) =>
                (call.type === 'moveTo' || call.type === 'lineTo') &&
                call.y === expectedY &&
                call.x >= node.x + CONNECTOR_ROW_INSET &&
                call.x <= node.x + node.width - CONNECTOR_ROW_INSET
        );
    }

    it('draws one hairline across the connector inset', () => {
        const { node, ctx } = renderNode();
        const expectedY = Math.round(separatorYOf(node)) + 0.5;
        const x1 = node.x + CONNECTOR_ROW_INSET;
        const x2 = node.x + node.width - CONNECTOR_ROW_INSET;
        const horizontalCalls = separatorSegment(ctx, node);

        assert.equal(horizontalCalls.length, 2, 'expected exactly one moveTo/lineTo pair');
        assert.deepEqual(
            horizontalCalls.map((call) => ({ type: call.type, x: call.x })),
            [
                { type: 'moveTo', x: x1 },
                { type: 'lineTo', x: x2 },
            ]
        );
        assert.equal(expectedY, separatorYOf(node) + 0.5);
        assert.equal(ctx.saveCount, ctx.restoreCount, 'save/restore must stay balanced');
        assert.equal(
            ctx.calls.filter((call) => call.type === 'fillRect' && call.height === 1).length,
            0,
            'the separator is a stroke, not a fill'
        );
    });

    it('omits the separator unless both sections are visible', () => {
        const controlsOnly = renderNode({ inputs: [], outputs: [] });
        assert.equal(separatorSegment(controlsOnly.ctx, controlsOnly.node).length, 0);

        const connectorsOnly = renderNode({}, []);
        assert.equal(separatorSegment(connectorsOnly.ctx, connectorsOnly.node).length, 0);

        const collapsed = renderNode({ collapsed: true });
        assert.equal(separatorSegment(collapsed.ctx, collapsed.node).length, 0);

        const narrow = renderNode({ width: 30 });
        assert.equal(separatorSegment(narrow.ctx, narrow.node).length, 0);
    });

    it('stays between the last control and the first connector row', () => {
        const { node, positions } = renderNode();
        const separatorY = separatorYOf(node);
        const lastControlBottom =
            node.y +
            NODE_HEADER_HEIGHT +
            NODE_BODY_PADDING +
            getControlsSectionHeight(controls) -
            CONTROL_SPACING;
        const firstConnectorTop = positions[0].y - CONTROL_HEIGHT / 2;

        assert.ok(separatorY > lastControlBottom);
        assert.ok(separatorY < firstConnectorTop);
    });

    it('is layout-neutral and not hit-testable', () => {
        const node = createNode({
            controls,
            inputs,
            outputs,
            controlValues: { count: 4, pin: 'x' },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);
        const height = calculateNodeHeight(
            node,
            (entry) => entry.controls,
            (entry) => entry.inputs,
            (entry) => entry.outputs
        );

        nodeUi.ensureNodeHeight();

        assert.equal(nodeUi.getBounds().height, height);

        const separatorY = separatorYOf(node);
        const hit = nodeUi.hitTestControl({
            x: node.x + node.width / 2,
            y: separatorY - (CONTROLS_CONNECTOR_GAP / 2 - 2),
        });

        assert.equal(hit, null, 'the separator itself is not clickable');
    });
});

describe('NodeUi.ensureNodeHeight() cache invalidation', () => {
    /**
     * One connector definition; the id must stay unique inside the patched list.
     * @param {string} id - Connector id.
     * @returns {object} Connector definition.
     */
    function input(id) {
        return { id, name: id, type: 'int' };
    }

    it('grows and shrinks with a connector patch instead of reusing the cached rows', () => {
        const node = createNode({ inputs: [input('in_0')], outputs: [] });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);

        nodeUi.ensureNodeHeight();
        const oneRowHeight = node.height;

        // A function-signature sync replaces the connector list; the cached visibility
        // snapshot must not keep the previous height.
        node.inputs = [input('in_0'), input('in_1'), input('in_2')];
        nodeUi.ensureNodeHeight();
        assert.ok(node.height > oneRowHeight, 'the node grows to fit the new rows');
        assert.equal(
            node.height,
            calculateNodeHeight(
                node,
                () => [],
                (entry) => entry.inputs,
                (entry) => entry.outputs
            ),
            'the patched height matches the current connector list'
        );

        node.inputs = [input('in_0')];
        nodeUi.ensureNodeHeight();
        assert.equal(node.height, oneRowHeight, 'the node shrinks back with the rows');
    });
});

describe('NodeControlUi.getCanvasLabelBounds()', () => {
    /**
     * Build a number control for the label-bounds tests.
     * @param {object} overrides - Control definition overrides.
     * @returns {NumberControlUi} Control instance.
     */
    function createNumberControl(overrides = {}) {
        return createControlInstance({
            id: 'count',
            type: 'number',
            label: 'Count',
            default: 1,
            ...overrides,
        });
    }

    it('reports the inline label rectangle the renderer actually draws', () => {
        const instance = createNumberControl();
        const ctx = createRecordingContext();
        const layout = {
            x: 10,
            y: 20,
            width: 200,
            height: CONTROL_HEIGHT + 6,
            labelWidth: 60,
        };

        const bounds = instance.getCanvasLabelBounds(ctx, layout);

        assert.deepEqual(bounds, {
            x: 10,
            y: 20 + (CONTROL_HEIGHT + 6) / 2 - CONTROL_HEIGHT / 2,
            width: estimate('Count'),
            height: CONTROL_HEIGHT,
        });

        const renderCtx = createRecordingContext();
        instance.renderCanvas(renderCtx, layout);
        const labelCall = renderCtx.calls.find((call) => call.type === 'fillText');

        assert.equal(labelCall.text, 'Count');
        assert.equal(labelCall.x, bounds.x, 'label must start where the bounds start');
        assert.equal(estimate(labelCall.text), bounds.width, 'bounds must cover the drawn text');
    });

    it('follows the ellipsised text when the column is too narrow', () => {
        const instance = createNumberControl({ label: 'Color Model' });
        const ctx = createRecordingContext();
        const layout = {
            x: 10,
            y: 20,
            width: 200,
            height: CONTROL_HEIGHT,
            labelWidth: 20,
        };

        const bounds = instance.getCanvasLabelBounds(ctx, layout);
        const renderCtx = createRecordingContext();
        instance.renderCanvas(renderCtx, layout);
        const labelCall = renderCtx.calls.find((call) => call.type === 'fillText');

        assert.ok(labelCall.text.endsWith('…'));
        assert.equal(bounds.width, estimate(labelCall.text));
        assert.ok(bounds.width <= 20, 'bounds must stay inside the label column');
    });

    it('falls back to the measured label without a shared column', () => {
        const instance = createNumberControl();
        const bounds = instance.getCanvasLabelBounds(createRecordingContext(), {
            x: 4,
            y: 8,
            width: 120,
            height: CONTROL_HEIGHT,
        });

        assert.equal(bounds.width, estimate('Count'));
        assert.equal(bounds.x, 4);
    });

    it('reports the stacked label row for stacked layouts', () => {
        const instance = createNumberControl({ label: 'Color Model', layout: 'stacked' });
        const layout = { x: 6, y: 30, width: 120, height: CONTROL_HEIGHT * 2 };

        const bounds = instance.getCanvasLabelBounds(createRecordingContext(), layout);

        assert.deepEqual(bounds, {
            x: 6,
            y: 30,
            width: estimate('Color Model'),
            height: CONTROL_HEIGHT,
        });
    });

    it('returns null when nothing is drawn', () => {
        const empty = createNumberControl({ id: '', label: '' });
        const layout = { x: 0, y: 0, width: 100, height: CONTROL_HEIGHT };

        assert.equal(empty.getCanvasLabelBounds(createRecordingContext(), layout), null);

        const narrow = createNumberControl();
        assert.equal(
            narrow.getCanvasLabelBounds(createRecordingContext(), { ...layout, width: 0 }),
            null,
            'a zero-width layout cannot show a label'
        );
    });

    it('borrows the measuring font without leaking context state', () => {
        const instance = createNumberControl();
        const ctx = createRecordingContext();
        ctx.font = '13px Sender';

        instance.getCanvasLabelBounds(ctx, {
            x: 0,
            y: 0,
            width: 100,
            height: CONTROL_HEIGHT,
        });

        assert.equal(ctx.font, '13px Sender', 'caller font is restored');
        assert.equal(ctx.saveCount, ctx.restoreCount, 'save/restore stay balanced');
    });

    it('agrees with the layout of every control type', () => {
        const defaults = {
            number: { default: 4 },
            text: { default: 'value' },
            dropdown: { default: 'a', options: [{ value: 'a', label: 'A' }] },
            checkbox: { default: true },
            slider: { default: 50, constraints: { min: 0, max: 100 } },
            color: { default: '#11223344' },
        };

        for (const [type, typeDefaults] of Object.entries(defaults)) {
            const definition = {
                id: `${type}-control`,
                type,
                label: 'Count',
                ...typeDefaults,
            };
            const instance = createControlInstance(definition);
            const layout = {
                x: 10,
                y: 20,
                width: 200,
                height: CONTROL_HEIGHT,
                labelWidth: 60,
            };

            const bounds = instance.getCanvasLabelBounds(createRecordingContext(), layout);
            const renderCtx = createRecordingContext();
            instance.renderCanvas(renderCtx, layout);
            const labelCall = renderCtx.calls.find((call) => call.type === 'fillText');

            assert.ok(labelCall, `${type} must draw a label`);
            assert.equal(estimate(labelCall.text), bounds.width, `${type} label width`);
            assert.equal(labelCall.x, bounds.x, `${type} label x`);
            assert.equal(bounds.height, CONTROL_HEIGHT, `${type} label row height`);
        }
    });
});
