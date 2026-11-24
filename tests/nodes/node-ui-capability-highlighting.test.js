// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { drawNode } from '../../src/micro_otter/nodes/html/js/nodes/node-ui-rendering.js';

function createMockContext() {
    const strokeStyles = [];

    return {
        strokeStyles,
        save() {},
        restore() {},
        beginPath() {},
        roundRect() {},
        fill() {},
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

describe('node-ui capability highlighting', () => {
    it('renders node border in capability error color when node has issues', () => {
        const ctx = createMockContext();

        drawNode(
            ctx,
            {
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
                capabilityIssues: [{ scope: 'node', message: 'Missing capability' }],
            },
            style,
            false,
            {},
            null,
            () => [],
            () => [],
            {
                getCurrentLocale: () => 'en',
                controlInstances: new Map(),
                inputDefaultControlInstances: new Map(),
            }
        );

        assert.ok(ctx.strokeStyles.includes('#f87171'));
    });

    it('renders control and input-default issue outlines in capability error color', () => {
        const ctx = createMockContext();

        const controlInstances = new Map([
            [
                'pin',
                {
                    getLayout: () => ({ height: 18 }),
                    renderCanvas() {},
                },
            ],
        ]);

        const inputDefaultControlInstances = new Map([
            [
                'in0',
                {
                    renderCanvas() {},
                },
            ],
        ]);

        drawNode(
            ctx,
            {
                id: 'node-1',
                type: 'core.test',
                x: 10,
                y: 20,
                width: 220,
                height: 140,
                collapsed: false,
                controls: [{ id: 'pin', type: 'number', label: 'Pin' }],
                inputs: [
                    {
                        id: 'in0',
                        name: 'Input 0',
                        defaultControl: { type: 'number' },
                    },
                ],
                outputs: [],
                capabilityIssues: [
                    {
                        scope: 'control',
                        controlId: 'pin',
                        message: 'Pin is invalid',
                    },
                    {
                        scope: 'input-default',
                        inputId: 'in0',
                        message: 'Input default is invalid',
                    },
                ],
            },
            style,
            false,
            {},
            null,
            (node) => node.controls,
            (kind) => {
                if (kind === 'input') {
                    return [
                        {
                            type: 'input',
                            index: 0,
                            x: 12,
                            y: 90,
                            id: 'in0',
                            label: 'Input 0',
                            inputData: {
                                id: 'in0',
                                defaultControl: { type: 'number' },
                            },
                        },
                    ];
                }
                return [];
            },
            {
                getCurrentLocale: () => 'en',
                graph: {
                    getConnections: () => [],
                },
                controlInstances,
                inputDefaultControlInstances,
            }
        );

        const issueStrokeCount = ctx.strokeStyles.filter((color) => color === '#f87171').length;
        assert.ok(issueStrokeCount >= 2);
    });
});
