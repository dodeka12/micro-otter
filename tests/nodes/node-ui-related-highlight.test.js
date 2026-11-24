import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    brightenColor,
    drawNode,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-rendering.js';
import {
    DEFAULT_STYLE,
    RELATED_NODE_BODY_BRIGHTEN,
    RELATED_NODE_BORDER_COLOR,
    RELATED_NODE_GLOW_COLOR,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js';

function createMockContext() {
    const strokeStyles = [];
    const shadowColors = [];
    const fillStyles = [];
    return {
        strokeStyles,
        shadowColors,
        fillStyles,
        save() {},
        restore() {},
        beginPath() {},
        roundRect() {},
        fill() {
            fillStyles.push(this._fillStyle);
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
            strokeStyles.push(this._strokeStyle);
        },
        fillText() {},
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
        set shadowColor(value) {
            this._shadowColor = value;
            shadowColors.push(value);
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

const style = {
    bodyColor: '#111',
    selectedBorderColor: '#fff',
    borderColor: '#999',
    headerColor: '#222',
    textColor: '#eee',
};

const CAPABILITY_ISSUE_BORDER_COLOR = '#f87171';

function createData(overrides = {}) {
    return {
        id: 'node-1',
        type: 'core.test',
        x: 10,
        y: 20,
        width: 180,
        height: 100,
        collapsed: true,
        controls: [],
        inputs: [],
        outputs: [],
        ...overrides,
    };
}

function createNodeUi() {
    return {
        getCurrentLocale: () => 'en',
        controlInstances: new Map(),
        inputDefaultControlInstances: new Map(),
    };
}

describe('node-ui related-node glow', () => {
    it('draws the related ring and outline in blue', () => {
        const ctx = createMockContext();
        drawNode(
            ctx,
            createData(),
            style,
            false,
            { relatedHighlight: true },
            null,
            () => [],
            () => [],
            createNodeUi()
        );

        assert.ok(ctx.strokeStyles.includes(RELATED_NODE_BORDER_COLOR));
        assert.ok(ctx.shadowColors.includes(RELATED_NODE_GLOW_COLOR));
        assert.ok(!ctx.strokeStyles.includes(style.selectedBorderColor));
        assert.ok(!ctx.shadowColors.includes(style.selectedBorderColor));
        assert.equal(ctx.fillStyles[0], brightenColor(style.bodyColor, RELATED_NODE_BODY_BRIGHTEN));
    });

    it('does not use the related-node colours when relatedHighlight is false', () => {
        const ctx = createMockContext();
        drawNode(
            ctx,
            createData(),
            style,
            false,
            { relatedHighlight: false },
            null,
            () => [],
            () => [],
            createNodeUi()
        );

        assert.ok(!ctx.strokeStyles.includes(RELATED_NODE_BORDER_COLOR));
        assert.ok(!ctx.shadowColors.includes(RELATED_NODE_GLOW_COLOR));
        assert.ok(ctx.strokeStyles.includes(style.borderColor));
        assert.equal(ctx.fillStyles[0], style.bodyColor);
    });

    it('keeps the selected node fill and yellow glow', () => {
        const ctx = createMockContext();
        drawNode(
            ctx,
            createData(),
            style,
            true,
            {},
            null,
            () => [],
            () => [],
            createNodeUi()
        );

        assert.ok(ctx.strokeStyles.includes(style.selectedBorderColor));
        assert.ok(ctx.shadowColors.includes(style.selectedBorderColor));
        assert.ok(!ctx.strokeStyles.includes(RELATED_NODE_BORDER_COLOR));
        assert.ok(!ctx.shadowColors.includes(RELATED_NODE_GLOW_COLOR));
        assert.equal(ctx.fillStyles[0], style.bodyColor);
    });

    it('keeps the capability-issue outline red for a related node', () => {
        const capabilityIssues = [
            {
                nodeId: 'node-1',
                scope: 'node',
                message: 'Required capability missing',
                capability: 'gpio',
                controlId: null,
                inputId: null,
                source: 'capabilityCheck',
            },
        ];
        const ctx = createMockContext();
        drawNode(
            ctx,
            createData({ capabilityIssues }),
            style,
            false,
            { relatedHighlight: true },
            null,
            () => [],
            () => [],
            createNodeUi()
        );

        assert.ok(ctx.strokeStyles.includes(CAPABILITY_ISSUE_BORDER_COLOR));
        assert.ok(ctx.strokeStyles.includes(RELATED_NODE_BORDER_COLOR));
        assert.equal(ctx.fillStyles[0], brightenColor(style.bodyColor, RELATED_NODE_BODY_BRIGHTEN));
    });
});

describe('related-node palette', () => {
    it('uses blue for the related-node outline and glow', () => {
        assert.equal(RELATED_NODE_BORDER_COLOR, 'rgba(96, 165, 250, 0.95)');
        assert.equal(RELATED_NODE_GLOW_COLOR, 'rgba(96, 165, 250, 0.55)');
    });

    it('keeps the related-node colours distinct from the selected-node border', () => {
        assert.notEqual(RELATED_NODE_BORDER_COLOR, DEFAULT_STYLE.selectedBorderColor);
        assert.notEqual(RELATED_NODE_GLOW_COLOR, DEFAULT_STYLE.selectedBorderColor);
    });
});

describe('brightenColor', () => {
    it('blends hex colours toward white while keeping the hue', () => {
        assert.equal(brightenColor('#000000', 0.2), '#333333');
        assert.equal(brightenColor('#5b7fc7', 0.2), '#7c99d2');
        assert.equal(brightenColor('#abc', 0.2), '#bbc9d6');
    });

    it('preserves the alpha channel of eight-digit hex colours', () => {
        assert.equal(brightenColor('#00000080', 0.2), '#33333380');
        assert.equal(brightenColor('#abcd', 0.2), '#bbc9d6dd');
    });

    it('clamps the blend amount', () => {
        assert.equal(brightenColor('#5b7fc7', 0), '#5b7fc7');
        assert.equal(brightenColor('#5b7fc7', 1), '#ffffff');
        assert.equal(brightenColor('#5b7fc7', 5), '#ffffff');
        assert.equal(brightenColor('#5b7fc7', -1), '#5b7fc7');
    });

    it('returns unsupported colours unchanged', () => {
        assert.equal(brightenColor('rgba(1, 2, 3, 0.5)', 0.2), 'rgba(1, 2, 3, 0.5)');
        assert.equal(brightenColor('red', 0.2), 'red');
    });
});
