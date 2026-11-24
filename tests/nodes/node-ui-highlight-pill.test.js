// Copyright (c) 2026 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Test: shared connector highlight pill.
 *
 * Covers the `drawHighlightPill()` primitive (`node-ui-helpers.ts`): geometry, colour,
 * edge cases, shared-context safety and the `drawConnectorLabel()` regression that proves
 * the extraction is pixel-neutral.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { drawHighlightPill } from '../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js';
import { drawConnectorLabel } from '../../src/micro_otter/nodes/html/js/nodes/node-ui-rendering.js';
import {
    CONNECTOR_HIGHLIGHT_LABEL_BACKGROUND_COLOR,
    CONNECTOR_HIGHLIGHT_LABEL_BORDER_WIDTH,
    CONNECTOR_HIGHLIGHT_LABEL_RADIUS,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js';

/**
 * Recording 2D context.
 * @returns {object} Mock context with call logs.
 */
function createRecordingContext() {
    const roundRectCalls = [];
    const fillCalls = [];
    const strokeCalls = [];
    const fillTextCalls = [];

    return {
        roundRectCalls,
        fillCalls,
        strokeCalls,
        fillTextCalls,
        saveCount: 0,
        restoreCount: 0,
        save() {
            this.saveCount += 1;
        },
        restore() {
            this.restoreCount += 1;
        },
        beginPath() {},
        roundRect(x, y, width, height, radius) {
            roundRectCalls.push({ x, y, width, height, radius });
        },
        fill() {
            fillCalls.push({ style: this._fillStyle, alpha: this._globalAlpha });
        },
        stroke() {
            strokeCalls.push({ style: this._strokeStyle, lineWidth: this._lineWidth });
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
    };
}

describe('drawHighlightPill', () => {
    it('paints one dark pill with a data-type-coloured border', () => {
        const ctx = createRecordingContext();

        drawHighlightPill(ctx, { x: 10, y: 20, width: 40, height: 16 }, '#7ba3d6');

        assert.deepEqual(ctx.roundRectCalls, [
            { x: 10, y: 20, width: 40, height: 16, radius: CONNECTOR_HIGHLIGHT_LABEL_RADIUS },
        ]);
        assert.deepEqual(ctx.fillCalls, [
            { style: CONNECTOR_HIGHLIGHT_LABEL_BACKGROUND_COLOR, alpha: undefined },
        ]);
        assert.deepEqual(ctx.strokeCalls, [
            { style: '#7ba3d6', lineWidth: CONNECTOR_HIGHLIGHT_LABEL_BORDER_WIDTH },
        ]);
        assert.deepEqual(ctx.fillTextCalls, [], 'the pill helper must never draw text');
    });

    it('honours an explicit corner radius', () => {
        const ctx = createRecordingContext();

        drawHighlightPill(ctx, { x: 0, y: 0, width: 10, height: 10 }, '#ffffff', 9);

        assert.deepEqual(ctx.roundRectCalls, [{ x: 0, y: 0, width: 10, height: 10, radius: 9 }]);
    });

    it('draws nothing for an empty or invalid rectangle', () => {
        const cases = [
            { x: 0, y: 0, width: 0, height: 16 },
            { x: 0, y: 0, width: 40, height: 0 },
            { x: 0, y: 0, width: -5, height: 16 },
            { x: 0, y: 0, width: 40, height: -1 },
            { x: Number.NaN, y: 0, width: 40, height: 16 },
            { x: 0, y: Number.NaN, width: 40, height: 16 },
            { x: 0, y: 0, width: Number.NaN, height: 16 },
            { x: 0, y: 0, width: 40, height: Number.NaN },
        ];

        for (const rect of cases) {
            const ctx = createRecordingContext();
            drawHighlightPill(ctx, rect, '#7ba3d6');

            assert.deepEqual(ctx.roundRectCalls, [], `no path for ${JSON.stringify(rect)}`);
            assert.deepEqual(ctx.fillCalls, [], `no fill for ${JSON.stringify(rect)}`);
            assert.deepEqual(ctx.strokeCalls, [], `no stroke for ${JSON.stringify(rect)}`);
            assert.equal(ctx.saveCount, 0, `no state push for ${JSON.stringify(rect)}`);
        }
    });

    it('leaves the caller state untouched so a shared context keeps drawing', () => {
        const ctx = createRecordingContext();
        ctx.font = '17px Test';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.globalAlpha = 0.4;

        drawHighlightPill(ctx, { x: 4, y: 6, width: 30, height: 16 }, '#e7c66b');

        assert.equal(ctx.saveCount, 1, 'exactly one save');
        assert.equal(ctx.restoreCount, ctx.saveCount, 'save/restore stay balanced');
        assert.equal(ctx.font, '17px Test', 'font is untouched');
        assert.equal(ctx.textAlign, 'center', 'textAlign is untouched');
        assert.equal(ctx.textBaseline, 'top', 'textBaseline is untouched');
        assert.equal(ctx.globalAlpha, 0.4, 'globalAlpha is untouched');
    });
});

describe('connector label pill regression', () => {
    it('keeps the extracted pill geometry of a highlighted label', () => {
        const ctx = createRecordingContext();

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
        assert.deepEqual(ctx.strokeCalls, [
            { style: '#e3e3e3', lineWidth: CONNECTOR_HIGHLIGHT_LABEL_BORDER_WIDTH },
        ]);
        assert.deepEqual(ctx.fillTextCalls, [
            { text: 'A', x: 100, y: 50, style: '#eeeeee', align: 'left' },
        ]);
    });

    it('mirrors the extracted pill for right-aligned labels', () => {
        const ctx = createRecordingContext();

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
        assert.deepEqual(ctx.strokeCalls, [
            { style: '#d8bf52', lineWidth: CONNECTOR_HIGHLIGHT_LABEL_BORDER_WIDTH },
        ]);
    });
});

