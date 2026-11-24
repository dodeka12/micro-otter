import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
    getInputDefaultControlBounds,
    getVisibleControls,
    getVisibleInputEntries,
    getVisibleInputs,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js';
import { resolveActiveInputIds } from '../../src/micro_otter/nodes/html/js/data/type-conversions.js';
import {
    computeConnectorPositions,
    drawConnectors,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-rendering.js';
import { hitTestControl } from '../../src/micro_otter/nodes/html/js/nodes/node-ui-hit-testing.js';
import { NodeUi } from '../../src/micro_otter/nodes/html/js/nodes/node-ui.js';
import {
    NODE_HEADER_HEIGHT,
    NODE_BODY_PADDING,
    CONNECTOR_RADIUS,
    CONNECTOR_OVERLAP,
    CONNECTOR_SPACING,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js';

function createRenderContext() {
    const state = {};
    const ctx = {
        save() {},
        restore() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        fill() {},
        fillText() {},
        scale() {},
        measureText() {
            return { width: 20 };
        },
    };
    for (const prop of [
        'fillStyle',
        'strokeStyle',
        'lineWidth',
        'font',
        'textAlign',
        'textBaseline',
        'globalAlpha',
    ]) {
        Object.defineProperty(ctx, prop, {
            get() {
                return state[prop];
            },
            set(value) {
                state[prop] = value;
            },
            configurable: true,
        });
    }
    return ctx;
}

const nonPrefixNode = {
    id: 'gen-1',
    collapsed: false,
    x: 0,
    y: 0,
    width: 160,
    height: 100,
    controls: [
        {
            type: 'dropdown',
            id: 'fillType',
            affectsInputs: true,
            default: 'ramp',
            options: [
                { value: 'fill', activeInputs: ['count', 'value'] },
                { value: 'ramp', activeInputs: ['count', 'start', 'end'] },
            ],
        },
    ],
    controlValues: { fillType: 'ramp' },
    inputs: [{ id: 'count' }, { id: 'value' }, { id: 'start' }, { id: 'end' }],
    outputs: [],
};

describe('connector visibility index helpers', () => {
    it('retains original input indices for non-prefix visible subsets', () => {
        const entries = getVisibleInputEntries(nonPrefixNode);
        assert.deepEqual(
            entries.map((entry) => entry.index),
            [0, 2, 3]
        );
        assert.deepEqual(
            entries.map((entry) => entry.entry.id),
            ['count', 'start', 'end']
        );
    });

    it('emits original index and visible row separately in connector positions', () => {
        const positions = computeConnectorPositions(
            'input',
            nonPrefixNode,
            (node) => node.controls || []
        );
        assert.deepEqual(
            positions.map((position) => position.index),
            [0, 2, 3]
        );
        assert.deepEqual(
            positions.map((position) => position.row),
            [0, 1, 2]
        );
    });

    it('resolves connectors by original index rather than visible row', () => {
        const graph = {
            getNode: (id) => (id === nonPrefixNode.id ? nonPrefixNode : null),
            getConnections: () => [],
            updateNodePosition: () => {},
            updateNode: () => {},
        };
        const nodeUi = new NodeUi(graph, nonPrefixNode.id);

        const start = nodeUi.getConnectorPosition('input', 2);
        assert.ok(start);
        assert.equal(start.id, 'start');

        const end = nodeUi.getConnectorPosition('input', 3);
        assert.ok(end);
        assert.equal(end.id, 'end');
    });

    it('renders hidden/reordered inputs without throwing', () => {
        const data = {
            ...nonPrefixNode,
            inputs: nonPrefixNode.inputs.map((input) => ({
                ...input,
                defaultControl: { type: 'number' },
            })),
        };
        const controlInstances = new Map(
            data.inputs.map((input) => [input.id, { renderCanvas: () => {} }])
        );

        assert.doesNotThrow(() => {
            drawConnectors(
                createRenderContext(),
                'input',
                data,
                null,
                null,
                { textColor: '#eeeeee' },
                (kind) => computeConnectorPositions(kind, data, (node) => node.controls || []),
                {
                    graph: { getConnections: () => [] },
                    inputDefaultControlInstances: controlInstances,
                    getCurrentLocale: () => 'en',
                }
            );
        });
    });

    it('hit-tests input default controls using the original input index', () => {
        const data = {
            id: 'hit-1',
            collapsed: false,
            x: 20,
            y: 20,
            width: 200,
            height: 140,
            controls: [],
            inputs: [
                { id: 'in0', defaultControl: { type: 'number' } },
                { id: 'in1', defaultControl: { type: 'number' } },
            ],
            outputs: [],
        };
        const inputCenterY =
            data.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING + CONNECTOR_RADIUS + CONNECTOR_SPACING;
        const bounds = getInputDefaultControlBounds({
            nodeX: data.x,
            nodeWidth: data.width,
            inputConnectorX: data.x + CONNECTOR_OVERLAP,
            inputCenterY,
            rowHasOpposingOutput: false,
        });
        const nodeUi = {
            getNodeData: () => data,
            controlInstances: new Map(),
            inputDefaultControlInstances: new Map([
                ['in0', { hitTest: () => ({ hit: true }) }],
                ['in1', { hitTest: () => ({ hit: true }) }],
            ]),
            graph: { getConnections: () => [] },
        };

        const hit = hitTestControl(nodeUi, {
            x: bounds.x + 2,
            y: bounds.y + bounds.height / 2,
        });

        assert.ok(hit);
        assert.equal(hit.controlId, 'in1');
        assert.equal(hit.isInputDefault, true);
    });
});

describe('connector visibility for core.select-index', () => {
    const definitionPath = path.resolve(
        'src/micro_otter/nodes/device/node_pkgs/core/node_definitions.json'
    );
    const definition = JSON.parse(readFileSync(definitionPath, 'utf8')).nodeTypes['select-index'];

    /**
     * Build node data from the shipped definition with one selected `count`.
     * @param count - Selected `count` dropdown value.
     * @returns Node data object the UI helpers accept.
     */
    function nodeData(count) {
        return {
            ...definition,
            collapsed: false,
            x: 0,
            y: 0,
            width: 180,
            height: 320,
            controlValues: { count },
        };
    }

    for (const count of [2, 8]) {
        it(`agrees with resolveActiveInputIds at count ${count}`, () => {
            const data = nodeData(count);
            const activeInputIds = resolveActiveInputIds(data);
            const visibleInputs = getVisibleInputs(data).map((input) => input.id);

            assert.ok(activeInputIds instanceof Set);
            assert.deepEqual(new Set(visibleInputs), activeInputIds);
            assert.deepEqual(visibleInputs, [
                'index',
                ...Array.from({ length: count }, (_, offset) => `value_${offset + 1}`),
            ]);
        });
    }

    it('keeps the original connector indices while the visible list shrinks', () => {
        const two = getVisibleInputEntries(nodeData(2));
        assert.deepEqual(
            two.map((entry) => entry.index),
            [0, 1, 2]
        );
        assert.deepEqual(
            two.map((entry) => entry.entry.id),
            ['index', 'value_1', 'value_2']
        );

        const eight = getVisibleInputEntries(nodeData(8));
        assert.deepEqual(
            eight.map((entry) => entry.index),
            [0, 1, 2, 3, 4, 5, 6, 7, 8]
        );
        assert.deepEqual(
            eight.map((entry) => entry.entry.id),
            [
                'index',
                'value_1',
                'value_2',
                'value_3',
                'value_4',
                'value_5',
                'value_6',
                'value_7',
                'value_8',
            ]
        );
    });

    it('keeps visible rows dense while original indices stay stable', () => {
        const two = computeConnectorPositions('input', nodeData(2), (node) => getVisibleControls(node));
        assert.deepEqual(
            two.map((position) => position.index),
            [0, 1, 2]
        );
        assert.deepEqual(
            two.map((position) => position.row),
            [0, 1, 2]
        );

        const eight = computeConnectorPositions('input', nodeData(8), (node) =>
            getVisibleControls(node)
        );
        assert.deepEqual(
            eight.map((position) => position.index),
            [0, 1, 2, 3, 4, 5, 6, 7, 8]
        );
        assert.deepEqual(
            eight.map((position) => position.row),
            [0, 1, 2, 3, 4, 5, 6, 7, 8]
        );
    });

    it('keeps earlier value connectors on their original indices when shrinking', () => {
        const eightById = new Map(
            getVisibleInputEntries(nodeData(8)).map(({ entry, index }) => [entry.id, index])
        );
        const twoById = new Map(
            getVisibleInputEntries(nodeData(2)).map(({ entry, index }) => [entry.id, index])
        );

        ['index', 'value_1', 'value_2'].forEach((inputId) => {
            assert.equal(twoById.get(inputId), eightById.get(inputId), `${inputId} must keep its index`);
        });
        assert.equal(twoById.get('index'), 0);
    });

    it('keeps the count dropdown visible for every selection', () => {
        for (let count = 2; count <= 8; count += 1) {
            const visibleControlIds = getVisibleControls(nodeData(count)).map(
                (control) => control.id
            );
            assert.deepEqual(visibleControlIds, ['count']);
        }
    });
});
