import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { drawNode } from '../../src/micro_otter/nodes/html/js/nodes/node-ui-rendering.js';
import TextControlUi from '../../src/micro_otter/nodes/html/js/nodes/controls/text-control-ui.js';
import {
    COLLAPSE_BUTTON_SIZE,
    NODE_HEADER_HEIGHT,
    NODE_HEADER_ICON_INSET,
    NODE_HEADER_ICON_SIZE,
    NODE_HEADER_TITLE_PADDING,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js';

function createMockContext() {
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
        fillRect(x, y, width, height) {
            calls.push({ type: 'fillRect', x, y, width, height });
        },
        drawImage(...args) {
            calls.push({ type: 'drawImage', args });
        },
        moveTo(x, y) {
            calls.push({ type: 'moveTo', x, y });
        },
        lineTo(x, y) {
            calls.push({ type: 'lineTo', x, y });
        },
        translate(x, y) {
            calls.push({ type: 'translate', x, y });
        },
        rotate(angle) {
            calls.push({ type: 'rotate', angle });
        },
        fillText(text, x, y) {
            calls.push({ type: 'fillText', text, x, y });
        },
        measureText(text) {
            return { width: String(text).length * 7 };
        },
        strokeRect() {},
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

describe('node-ui-rendering title i18n', () => {
    it('renders localized typeName when userName is not set', () => {
        const ctx = createMockContext();
        const data = {
            id: 1,
            type: 'core.constant',
            typeName: { en: 'Constant', de: 'Konstante' },
            userName: null,
            x: 10,
            y: 20,
            width: 140,
            height: 90,
            collapsed: false,
            inputs: [],
            outputs: [],
            controls: [],
        };

        drawNode(
            ctx,
            data,
            {
                bodyColor: '#111',
                selectedBorderColor: '#fff',
                borderColor: '#999',
                headerColor: '#222',
                textColor: '#eee',
            },
            false,
            {},
            null,
            () => [],
            () => [],
            { getCurrentLocale: () => 'de', controlInstances: new Map() }
        );

        const titleCall = ctx.calls.find((call) => call.type === 'fillText');
        assert.ok(titleCall);
        assert.equal(titleCall.text, 'Konstante');
    });

    it('renders userName regardless of locale', () => {
        const ctx = createMockContext();
        const data = {
            id: 1,
            type: 'core.constant',
            typeName: { en: 'Constant', de: 'Konstante' },
            userName: { de: 'Benutzerwert' },
            x: 10,
            y: 20,
            width: 140,
            height: 90,
            collapsed: false,
            inputs: [],
            outputs: [],
            controls: [],
        };

        drawNode(
            ctx,
            data,
            {
                bodyColor: '#111',
                selectedBorderColor: '#fff',
                borderColor: '#999',
                headerColor: '#222',
                textColor: '#eee',
            },
            false,
            {},
            null,
            () => [],
            () => [],
            { getCurrentLocale: () => 'de', controlInstances: new Map() }
        );

        const titleCall = ctx.calls.find((call) => call.type === 'fillText');
        assert.ok(titleCall);
        assert.equal(titleCall.text, 'Benutzerwert');
    });

    it('falls back to localized typeName when locale-specific userName entry is missing', () => {
        const ctx = createMockContext();
        const data = {
            id: 1,
            type: 'core.constant',
            typeName: { en: 'Constant', de: 'Konstante' },
            userName: { en: 'Custom EN' },
            x: 10,
            y: 20,
            width: 140,
            height: 90,
            collapsed: false,
            inputs: [],
            outputs: [],
            controls: [],
        };

        drawNode(
            ctx,
            data,
            {
                bodyColor: '#111',
                selectedBorderColor: '#fff',
                borderColor: '#999',
                headerColor: '#222',
                textColor: '#eee',
            },
            false,
            {},
            null,
            () => [],
            () => [],
            { getCurrentLocale: () => 'de', controlInstances: new Map() }
        );

        const titleCall = ctx.calls.find((call) => call.type === 'fillText');
        assert.ok(titleCall);
        assert.equal(titleCall.text, 'Konstante');
    });

    it('updates rendered title when locale changes without mutating node data', () => {
        const ctx = createMockContext();
        const data = {
            id: 1,
            type: 'core.constant',
            typeName: { en: 'Constant', de: 'Konstante' },
            userName: { en: 'Custom EN' },
            x: 10,
            y: 20,
            width: 140,
            height: 90,
            collapsed: false,
            inputs: [],
            outputs: [],
            controls: [],
        };

        const localeState = { currentLocale: 'en' };
        const nodeUi = {
            getCurrentLocale: () => localeState.currentLocale,
            controlInstances: new Map(),
        };

        drawNode(
            ctx,
            data,
            {
                bodyColor: '#111',
                selectedBorderColor: '#fff',
                borderColor: '#999',
                headerColor: '#222',
                textColor: '#eee',
            },
            false,
            {},
            null,
            () => [],
            () => [],
            nodeUi
        );

        localeState.currentLocale = 'de';

        drawNode(
            ctx,
            data,
            {
                bodyColor: '#111',
                selectedBorderColor: '#fff',
                borderColor: '#999',
                headerColor: '#222',
                textColor: '#eee',
            },
            false,
            {},
            null,
            () => [],
            () => [],
            nodeUi
        );

        const titleCalls = ctx.calls.filter((call) => call.type === 'fillText');
        assert.ok(titleCalls.length >= 2);
        assert.equal(titleCalls[0].text, 'Custom EN');
        assert.equal(titleCalls[1].text, 'Konstante');
        assert.deepEqual(data.userName, { en: 'Custom EN' });
    });

    it('updates connector and control labels when locale changes', () => {
        const ctx = createMockContext();
        const localeState = { currentLocale: 'en' };

        const data = {
            id: 1,
            type: 'core.output',
            typeName: { en: 'Print', de: 'Ausgabe' },
            userName: null,
            x: 10,
            y: 20,
            width: 260,
            height: 120,
            collapsed: false,
            inputs: [
                {
                    id: 'title',
                    name: { en: 'Title', de: 'Titel' },
                    allowedTypes: ['string'],
                },
            ],
            outputs: [
                {
                    id: 'element',
                    name: { en: 'Element', de: 'Element DE' },
                    outputType: 'web.element',
                },
            ],
            controls: [
                {
                    id: 'caption',
                    type: 'text',
                    label: { en: 'Caption', de: 'Beschriftung' },
                    default: 'A',
                },
            ],
            controlValues: {
                caption: 'A',
            },
        };

        const nodeUi = {
            getCurrentLocale: () => localeState.currentLocale,
            controlInstances: new Map(),
            inputDefaultControlInstances: new Map(),
        };

        const captionControl = new TextControlUi(data.controls[0], data, nodeUi);
        nodeUi.controlInstances.set('caption', captionControl);

        const getConnectorPositions = (kind) => {
            if (kind === 'input') {
                return [{ index: 0, x: 10, y: 70, id: 'title', label: data.inputs[0].name }];
            }
            return [{ index: 0, x: 170, y: 70, id: 'element', label: data.outputs[0].name }];
        };

        drawNode(
            ctx,
            data,
            {
                bodyColor: '#111',
                selectedBorderColor: '#fff',
                borderColor: '#999',
                headerColor: '#222',
                textColor: '#eee',
            },
            false,
            {},
            null,
            (node) => node.controls,
            getConnectorPositions,
            nodeUi
        );

        localeState.currentLocale = 'de';

        drawNode(
            ctx,
            data,
            {
                bodyColor: '#111',
                selectedBorderColor: '#fff',
                borderColor: '#999',
                headerColor: '#222',
                textColor: '#eee',
            },
            false,
            {},
            null,
            (node) => node.controls,
            getConnectorPositions,
            nodeUi
        );

        const fillTextCalls = ctx.calls
            .filter((call) => call.type === 'fillText')
            .map((call) => call.text);

        assert.ok(fillTextCalls.includes('Title'));
        assert.ok(fillTextCalls.includes('Caption'));
        assert.ok(fillTextCalls.includes('Titel'));
        assert.ok(fillTextCalls.includes('Beschriftung'));
    });

    it('falls back to runtime localized title for legacy en-only typeName', () => {
        const ctx = createMockContext();
        const data = {
            id: 1,
            type: 'core.constant',
            typeName: { en: 'Constant' },
            userName: null,
            x: 10,
            y: 20,
            width: 140,
            height: 90,
            collapsed: false,
            inputs: [],
            outputs: [],
            controls: [],
        };

        const nodeUi = {
            getCurrentLocale: () => 'de',
            getWorkspace: () => ({
                runtimeCollection: {
                    getActiveRuntime: () => ({
                        getNodeType: (typeId) =>
                            typeId === 'core.constant'
                                ? { title: { en: 'Constant', de: 'Konstante' } }
                                : null,
                    }),
                },
            }),
            controlInstances: new Map(),
        };

        drawNode(
            ctx,
            data,
            {
                bodyColor: '#111',
                selectedBorderColor: '#fff',
                borderColor: '#999',
                headerColor: '#222',
                textColor: '#eee',
            },
            false,
            {},
            null,
            () => [],
            () => [],
            nodeUi
        );

        const titleCall = ctx.calls.find((call) => call.type === 'fillText');
        assert.ok(titleCall);
        assert.equal(titleCall.text, 'Konstante');
    });
});

describe('node-ui-rendering title clearance', () => {
    const STYLE = {
        bodyColor: '#111',
        selectedBorderColor: '#fff',
        borderColor: '#999',
        headerColor: '#222',
        textColor: '#eee',
    };

    const SAFE_LEFT_OFFSET =
        NODE_HEADER_ICON_INSET + NODE_HEADER_ICON_SIZE + NODE_HEADER_TITLE_PADDING;
    const SAFE_RIGHT_OFFSET = COLLAPSE_BUTTON_SIZE - NODE_HEADER_TITLE_PADDING;

    function createTitleData(overrides = {}) {
        return {
            id: 1,
            type: 'core.constant',
            typeName: { en: 'Constant' },
            userName: null,
            x: 10,
            y: 20,
            width: 140,
            height: 90,
            collapsed: false,
            inputs: [],
            outputs: [],
            controls: [],
            ...overrides,
        };
    }

    function renderTitle(data) {
        const ctx = createMockContext();
        drawNode(
            ctx,
            data,
            STYLE,
            false,
            {},
            null,
            () => [],
            () => [],
            {
                getCurrentLocale: () => 'en',
                controlInstances: new Map(),
            }
        );
        return ctx;
    }

    it('centres a short title inside the free header span', () => {
        const data = createTitleData();
        const ctx = renderTitle(data);
        const titleCall = ctx.calls.find((call) => call.type === 'fillText');
        const safeLeft = data.x + SAFE_LEFT_OFFSET;
        const safeRight = data.x + data.width - SAFE_RIGHT_OFFSET;

        assert.ok(titleCall);
        assert.equal(titleCall.text, 'Constant');
        assert.equal(titleCall.x, safeLeft + (safeRight - safeLeft) / 2);
        assert.notEqual(titleCall.x, data.x + data.width / 2);
    });

    it('ellipsises a long title instead of drawing under the header chrome', () => {
        const data = createTitleData({ userName: 'A very long node name indeed' });
        const ctx = renderTitle(data);
        const titleCall = ctx.calls.find((call) => call.type === 'fillText');
        const safeWidth = data.width - SAFE_LEFT_OFFSET - SAFE_RIGHT_OFFSET;

        assert.ok(titleCall);
        assert.ok(titleCall.text.endsWith('…'));
        assert.ok(titleCall.text.length * 7 <= safeWidth);
        assert.ok(titleCall.x - safeWidth / 2 >= data.x + SAFE_LEFT_OFFSET - 0.001);
    });

    it('skips the title on nodes narrower than the header chrome', () => {
        const data = createTitleData({ width: 40 });
        const ctx = renderTitle(data);

        assert.equal(ctx.calls.filter((call) => call.type === 'fillText').length, 0);
    });

    it('keeps the icon and collapse chevron in place', () => {
        const data = createTitleData({ collapsed: true });
        const ctx = renderTitle(data);
        const iconRect = ctx.calls.find(
            (call) => call.type === 'fillRect' && call.width === NODE_HEADER_ICON_SIZE
        );
        const chevron = ctx.calls.find((call) => call.type === 'translate' && call.y > data.y);

        assert.ok(iconRect);
        assert.equal(iconRect.x, data.x + NODE_HEADER_ICON_INSET);
        assert.equal(iconRect.height, NODE_HEADER_ICON_SIZE);

        assert.ok(chevron);
        assert.equal(chevron.x, data.x + data.width - COLLAPSE_BUTTON_SIZE / 2);
        assert.equal(chevron.y, data.y + NODE_HEADER_HEIGHT / 2);
        assert.ok(
            ctx.calls.some((call) => call.type === 'rotate'),
            'a collapsed node rotates the chevron'
        );
    });
});
