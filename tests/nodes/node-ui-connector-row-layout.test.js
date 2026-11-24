// Copyright (c) 2026 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Test: connector row width reservation.
 *
 * Covers the measured output-label reservation (`getInputDefaultControlBounds()`), the
 * label measurement/resolution primitives and the content-derived node minimum width
 * (`computeNodeMinContentWidth()`). Runs headless, so label widths use the deterministic
 * per-character estimate.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    CONNECTOR_LABEL_FONT,
    CONNECTOR_LABEL_OFFSET,
    CONNECTOR_OVERLAP,
    CONNECTOR_ROW_RESERVED_GAP,
    CONTROL_HEIGHT,
    INPUT_DEFAULT_CONTROL_MIN_WIDTH,
    NODE_BODY_PADDING,
    OUTPUT_LABEL_CHAR_WIDTH_ESTIMATE,
    OUTPUT_LABEL_RESERVED_WIDTH,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js';
import {
    computeNodeMinContentWidth,
    getInputDefaultControlBounds,
    measureConnectorLabelWidth,
    resolveConnectorLabelText,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js';

/** Distance from the node edge to a connector label or default control. */
const ROW_INSET = CONNECTOR_OVERLAP + CONNECTOR_LABEL_OFFSET;

function estimate(text) {
    return text.length * OUTPUT_LABEL_CHAR_WIDTH_ESTIMATE;
}

function createNode(overrides = {}) {
    return {
        id: 'node-1',
        x: 0,
        y: 0,
        width: 140,
        height: 120,
        collapsed: false,
        controls: [],
        controlValues: {},
        inputs: [],
        outputs: [],
        ...overrides,
    };
}

function boundsFor({ nodeWidth = 220, opposingOutputLabelWidth, rowHasOpposingOutput = true }) {
    return getInputDefaultControlBounds({
        nodeX: 0,
        nodeWidth,
        inputConnectorX: CONNECTOR_OVERLAP,
        inputCenterY: 50,
        rowHasOpposingOutput,
        opposingOutputLabelWidth,
        controlHeight: CONTROL_HEIGHT,
    });
}

describe('connector row width constants', () => {
    it('keeps the documented row layout constants', () => {
        assert.equal(CONNECTOR_ROW_RESERVED_GAP, 6);
        assert.equal(OUTPUT_LABEL_RESERVED_WIDTH, 84);
        assert.equal(OUTPUT_LABEL_CHAR_WIDTH_ESTIMATE, 7);
        assert.equal(NODE_BODY_PADDING, 6);
        assert.equal(ROW_INSET, 16);
    });

    it('provides an operable minimum control width', () => {
        assert.equal(INPUT_DEFAULT_CONTROL_MIN_WIDTH, 64);
        assert.ok(INPUT_DEFAULT_CONTROL_MIN_WIDTH >= 48);
        assert.ok(INPUT_DEFAULT_CONTROL_MIN_WIDTH <= 80);
    });

    it('measures with the same font the renderer draws with', () => {
        assert.match(CONNECTOR_LABEL_FONT, /^\d+px /);
        assert.equal(CONNECTOR_LABEL_FONT, '11px "Segoe UI", Arial, sans-serif');
    });
});

describe('measureConnectorLabelWidth()', () => {
    it('returns zero for missing or empty labels', () => {
        assert.equal(measureConnectorLabelWidth(''), 0);
        assert.equal(measureConnectorLabelWidth(null), 0);
        assert.equal(measureConnectorLabelWidth(undefined), 0);
    });

    it('falls back to the deterministic character estimate without a canvas', () => {
        assert.equal(measureConnectorLabelWidth('Out'), estimate('Out'));
        assert.equal(measureConnectorLabelWidth('Envelope Follow'), estimate('Envelope Follow'));
    });

    it('measures longer labels wider and memoises the result', () => {
        const short = measureConnectorLabelWidth('Out');
        const long = measureConnectorLabelWidth('Envelope Follow');

        assert.ok(long > short);
        assert.equal(measureConnectorLabelWidth('Out'), short);
        assert.equal(measureConnectorLabelWidth('Envelope Follow'), long);
    });
});

describe('resolveConnectorLabelText()', () => {
    it('prefers name over label over id', () => {
        assert.equal(resolveConnectorLabelText({ name: 'Name', label: 'Label', id: 'id' }), 'Name');
        assert.equal(resolveConnectorLabelText({ label: 'Label', id: 'id' }), 'Label');
        assert.equal(resolveConnectorLabelText({ id: 'id' }), 'id');
    });

    it('resolves localized labels for the given locale', () => {
        assert.equal(
            resolveConnectorLabelText({ name: { en: 'Gain', de: 'Verstärkung' } }, 'de'),
            'Verstärkung'
        );
        assert.equal(
            resolveConnectorLabelText({ name: { en: 'Gain', de: 'Verstärkung' } }, 'fr'),
            'Gain'
        );
    });

    it('skips empty values and unknown shapes', () => {
        assert.equal(resolveConnectorLabelText({ name: '   ', label: 'Fallback' }), 'Fallback');
        assert.equal(resolveConnectorLabelText({ name: {}, label: {} }), '');
        assert.equal(resolveConnectorLabelText(null), '');
        assert.equal(resolveConnectorLabelText(undefined), '');
        assert.equal(resolveConnectorLabelText({ id: 7 }), '7');
    });
});

describe('getInputDefaultControlBounds()', () => {
    it('reserves exactly the measured output label width', () => {
        const labelWidth = measureConnectorLabelWidth('Out');
        const bounds = boundsFor({ opposingOutputLabelWidth: labelWidth });

        assert.equal(bounds.x, ROW_INSET);
        assert.equal(
            bounds.width,
            220 - ROW_INSET - labelWidth - CONNECTOR_ROW_RESERVED_GAP - ROW_INSET
        );
        assert.equal(
            bounds.x + bounds.width,
            220 - ROW_INSET - labelWidth - CONNECTOR_ROW_RESERVED_GAP
        );
        assert.equal(bounds.height, CONTROL_HEIGHT);
        assert.equal(bounds.y, 50 - CONTROL_HEIGHT / 2);
    });

    it('falls back to the fixed reservation without a measured width', () => {
        const measured = boundsFor({
            opposingOutputLabelWidth: measureConnectorLabelWidth('Out'),
        });
        const fallback = boundsFor({});

        assert.equal(
            fallback.width,
            measured.width - (OUTPUT_LABEL_RESERVED_WIDTH - measureConnectorLabelWidth('Out'))
        );
        assert.ok(fallback.width < measured.width);
    });

    it('falls back for invalid measured widths', () => {
        const fallback = boundsFor({});
        assert.deepEqual(boundsFor({ opposingOutputLabelWidth: Number.NaN }), fallback);
        assert.deepEqual(boundsFor({ opposingOutputLabelWidth: -10 }), fallback);
        assert.deepEqual(boundsFor({ opposingOutputLabelWidth: undefined }), fallback);
    });

    it('keeps a short label of zero width usable', () => {
        const bounds = boundsFor({ nodeWidth: 140, opposingOutputLabelWidth: 0 });

        assert.equal(bounds.width, 140 - ROW_INSET - CONNECTOR_ROW_RESERVED_GAP - ROW_INSET);
        assert.ok(bounds.width > INPUT_DEFAULT_CONTROL_MIN_WIDTH);
    });

    it('never returns less than the minimum control width', () => {
        const narrow = boundsFor({
            nodeWidth: 140,
            opposingOutputLabelWidth: measureConnectorLabelWidth('Out'),
        });
        const cramped = boundsFor({ nodeWidth: 60, opposingOutputLabelWidth: 40 });

        assert.equal(
            narrow.width,
            140 -
                ROW_INSET -
                measureConnectorLabelWidth('Out') -
                CONNECTOR_ROW_RESERVED_GAP -
                ROW_INSET
        );
        assert.equal(cramped.width, INPUT_DEFAULT_CONTROL_MIN_WIDTH);
    });

    it('uses the node body width for input-only rows', () => {
        const bounds = boundsFor({ nodeWidth: 400, rowHasOpposingOutput: false });

        assert.equal(bounds.width, 400 - NODE_BODY_PADDING - ROW_INSET);
    });
});

describe('computeNodeMinContentWidth()', () => {
    const defaultControl = { id: 'in0', type: 'number', default: 1 };
    const opposedNode = () =>
        createNode({
            inputs: [{ id: 'in0', name: 'In', defaultControl }],
            outputs: [{ id: 'out0', name: 'Out' }],
        });

    it('reserves the control minimum plus the measured output label on opposed rows', () => {
        assert.equal(
            computeNodeMinContentWidth(opposedNode()),
            ROW_INSET +
                INPUT_DEFAULT_CONTROL_MIN_WIDTH +
                CONNECTOR_ROW_RESERVED_GAP +
                estimate('Out') +
                ROW_INSET
        );
    });

    it('grows with longer output labels', () => {
        const shortLabelNode = opposedNode();
        const longLabelNode = createNode({
            inputs: [{ id: 'in0', name: 'In', defaultControl }],
            outputs: [{ id: 'out0', name: 'Envelope Follow' }],
        });

        assert.equal(
            computeNodeMinContentWidth(longLabelNode) - computeNodeMinContentWidth(shortLabelNode),
            estimate('Envelope Follow') - estimate('Out')
        );
    });

    it('reserves the wider of the input label and the minimum control width', () => {
        const shortLabelNode = createNode({
            inputs: [{ id: 'in0', name: 'In', defaultControl }],
        });
        const longLabelNode = createNode({
            inputs: [{ id: 'in0', name: 'A very long input label', defaultControl }],
        });

        assert.equal(
            computeNodeMinContentWidth(shortLabelNode),
            ROW_INSET + INPUT_DEFAULT_CONTROL_MIN_WIDTH + NODE_BODY_PADDING
        );
        assert.equal(
            computeNodeMinContentWidth(longLabelNode),
            ROW_INSET + estimate('A very long input label') + NODE_BODY_PADDING
        );
    });

    it('only reserves the input label when no default control renders', () => {
        const node = createNode({
            inputs: [{ id: 'in0', name: 'In' }],
            outputs: [{ id: 'out0', name: 'Out' }],
        });

        assert.equal(
            computeNodeMinContentWidth(node),
            ROW_INSET + estimate('In') + CONNECTOR_ROW_RESERVED_GAP + estimate('Out') + ROW_INSET
        );

        assert.equal(
            computeNodeMinContentWidth(node, { hasDefaultControl: () => true }),
            ROW_INSET +
                INPUT_DEFAULT_CONTROL_MIN_WIDTH +
                CONNECTOR_ROW_RESERVED_GAP +
                estimate('Out') +
                ROW_INSET
        );
    });

    it('widens output-only rows by the label width', () => {
        const node = createNode({ outputs: [{ id: 'out0', name: 'Out' }] });

        assert.equal(computeNodeMinContentWidth(node), ROW_INSET + estimate('Out'));
    });

    it('honours dropdown-driven connector visibility', () => {
        const node = createNode({
            inputs: [{ id: 'in0', name: 'In', defaultControl }],
            outputs: [
                { id: 'out0', name: 'Outgoing Signal' },
                { id: 'out1', name: 'Very Long Output Signal Value' },
            ],
            controls: [
                {
                    id: 'mode',
                    type: 'dropdown',
                    affectsOutputs: true,
                    default: 'short',
                    options: [
                        { value: 'short', activeOutputs: ['out0'] },
                        { value: 'long', activeOutputs: ['out0', 'out1'] },
                    ],
                },
            ],
        });

        // The connector rows are wider than the control column, so the visible output
        // labels drive the result.
        assert.equal(
            computeNodeMinContentWidth(node),
            ROW_INSET +
                INPUT_DEFAULT_CONTROL_MIN_WIDTH +
                CONNECTOR_ROW_RESERVED_GAP +
                estimate('Outgoing Signal') +
                ROW_INSET
        );

        node.controlValues = { mode: 'long' };
        assert.equal(
            computeNodeMinContentWidth(node),
            ROW_INSET + estimate('Very Long Output Signal Value')
        );
    });

    it('returns zero for collapsed nodes and nodes without connector rows', () => {
        const collapsedNode = createNode({
            collapsed: true,
            inputs: [{ id: 'in0', name: 'In' }],
        });

        assert.equal(computeNodeMinContentWidth(collapsedNode), 0);
        assert.equal(computeNodeMinContentWidth(createNode()), 0);
        assert.equal(computeNodeMinContentWidth(null), 0);
    });

    it('returns a ceiled integer width', () => {
        assert.ok(Number.isInteger(computeNodeMinContentWidth(opposedNode())));
    });

    it('gives the control its minimum width once the node is widened', () => {
        const minWidth = computeNodeMinContentWidth(opposedNode());
        const bounds = boundsFor({
            nodeWidth: minWidth,
            opposingOutputLabelWidth: estimate('Out'),
        });
        const outputLabelStart = minWidth - ROW_INSET - estimate('Out');

        assert.equal(bounds.width, INPUT_DEFAULT_CONTROL_MIN_WIDTH);
        assert.equal(bounds.x + bounds.width, outputLabelStart - CONNECTOR_ROW_RESERVED_GAP);
    });
});
