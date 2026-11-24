import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createDomHarness } from '../helpers/dom-harness.js';
import { NodeUi } from '../../src/micro_otter/nodes/html/js/nodes/node-ui.js';
import {
    NumberControlUi,
    TextControlUi,
    NodeDropdownControlUi,
    CheckboxControlUi,
    SliderControlUi,
    ColorControlUi,
    IconControlUi,
} from '../../src/micro_otter/nodes/html/js/nodes/controls/index.js';
import {
    NODE_HEADER_HEIGHT,
    NODE_BODY_PADDING,
    CONNECTOR_ROW_INSET,
    CONTROLS_CONNECTOR_GAP,
    CONTROL_HEIGHT,
    CONTROL_LABEL_MARGIN,
    CONTROL_SPACING,
    COLLAPSE_BUTTON_SIZE,
    CONNECTOR_RADIUS,
    CONNECTOR_SPACING,
    CONNECTOR_LABEL_OFFSET,
    CONNECTOR_OVERLAP,
    CONNECTOR_ROW_RESERVED_GAP,
    CONNECTOR_LABEL_FONT,
    INPUT_DEFAULT_CONTROL_FONT_SCALE,
    INPUT_DEFAULT_CONTROL_MIN_WIDTH,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js';
import {
    getInputDefaultControlBounds,
    measureConnectorLabelWidth,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js';

function createNode(overrides = {}) {
    const node = {
        id: 'node-1',
        type: 'test.node',
        x: 100,
        y: 80,
        width: 220,
        height: 180,
        title: 'Test Node',
        collapsed: false,
        controls: [],
        inputs: [],
        outputs: [],
        controlValues: {},
        inputDefaults: {},
        setPosition(x, y) {
            this.x = x;
            this.y = y;
        },
    };

    Object.assign(node, overrides);
    return node;
}

function createGraph(node) {
    const updateCalls = [];

    const graph = {
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
            if (nodeId !== node.id) {
                return;
            }

            if (patch.controlValues) {
                node.controlValues = { ...patch.controlValues };
            }

            if (patch.inputDefaults) {
                node.inputDefaults = { ...patch.inputDefaults };
            }

            Object.assign(node, patch);
        },
    };

    return graph;
}

describe('NodeUi controls integration migration', () => {
    let harness;

    beforeEach(() => {
        harness = createDomHarness();
    });

    afterEach(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.cleanup();
    });

    it('creates known control instances and skips unknown control definitions', () => {
        const node = createNode({
            controls: [
                { id: 'num', type: 'number', label: 'Number', default: 10 },
                { id: 'txt', type: 'text', label: 'Text', default: 'hello' },
                {
                    id: 'dd',
                    type: 'dropdown',
                    label: 'Mode',
                    default: 'a',
                    options: [{ value: 'a', label: 'A' }],
                },
                { id: 'ck', type: 'checkbox', label: 'Enabled', default: false },
                { id: 'sl', type: 'slider', label: 'Speed', default: 50 },
                { id: 'col', type: 'color', label: 'Color', default: '#112233FF' },
                { id: 'icn', type: 'icon', label: 'Icon', default: 'mdi:lightbulb' },
                { id: 'unknown', type: 'unsupported', label: 'Legacy' },
            ],
            controlValues: {
                num: 12,
                txt: 'world',
                dd: 'a',
                ck: true,
                sl: 75,
                col: '#AABBCCFF',
                icn: 'mdi:home',
            },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);

        assert.equal(nodeUi.controlInstances.size, 7);
        assert.ok(nodeUi.controlInstances.get('num') instanceof NumberControlUi);
        assert.ok(nodeUi.controlInstances.get('txt') instanceof TextControlUi);
        assert.ok(nodeUi.controlInstances.get('dd') instanceof NodeDropdownControlUi);
        assert.ok(nodeUi.controlInstances.get('ck') instanceof CheckboxControlUi);
        assert.ok(nodeUi.controlInstances.get('sl') instanceof SliderControlUi);
        assert.ok(nodeUi.controlInstances.get('col') instanceof ColorControlUi);
        assert.ok(nodeUi.controlInstances.get('icn') instanceof IconControlUi);
        assert.equal(nodeUi.controlInstances.has('unknown'), false);
    });

    it('rebinds graph/node and rebuilds control instances with setGraph', () => {
        const nodeA = createNode({
            id: 'node-a',
            controls: [{ id: 'ctrl', type: 'number', label: 'A', default: 1 }],
            controlValues: { ctrl: 4 },
        });
        const graphA = createGraph(nodeA);
        const nodeUi = new NodeUi(graphA, nodeA.id);

        assert.equal(nodeUi.controlInstances.size, 1);
        assert.ok(nodeUi.controlInstances.get('ctrl') instanceof NumberControlUi);

        const nodeB = createNode({
            id: 'node-b',
            controls: [
                { id: 'ctrl', type: 'text', label: 'B', default: 'x' },
                {
                    id: 'mode',
                    type: 'dropdown',
                    label: 'Mode',
                    default: 'on',
                    options: [{ value: 'on', label: 'On' }],
                },
            ],
            controlValues: { ctrl: 'hello', mode: 'on' },
        });
        const graphB = createGraph(nodeB);

        nodeUi.setGraph(graphB, nodeB.id);

        assert.equal(nodeUi.controlInstances.size, 2);
        assert.ok(nodeUi.controlInstances.get('ctrl') instanceof TextControlUi);
        assert.ok(nodeUi.controlInstances.get('mode') instanceof NodeDropdownControlUi);
    });

    it('hit tests header regions and controls through NodeUi public methods', () => {
        const node = createNode({
            controls: [
                { id: 'first', type: 'number', label: 'First', default: 10 },
                { id: 'second', type: 'text', label: 'Second', default: 'ok' },
            ],
            controlValues: { first: 10, second: 'ok' },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);

        const collapseHit = nodeUi.hitTestHeader({
            x: node.x + node.width - COLLAPSE_BUTTON_SIZE + 1,
            y: node.y + 2,
        });
        assert.equal(collapseHit?.type, 'collapse');

        const nameHit = nodeUi.hitTestHeader({ x: node.x + 40, y: node.y + 2 });
        assert.equal(nameHit?.type, 'name');

        const missHeader = nodeUi.hitTestHeader({ x: node.x - 20, y: node.y - 20 });
        assert.equal(missHeader, null);

        const bodyLeft = node.x + CONNECTOR_ROW_INSET + 2;
        const firstControlY = node.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING + 2;
        const secondControlY = firstControlY + CONTROL_HEIGHT + CONTROL_SPACING;

        const firstHit = nodeUi.hitTestControl({ x: bodyLeft, y: firstControlY });
        assert.equal(firstHit?.controlId, 'first');

        const secondHit = nodeUi.hitTestControl({ x: bodyLeft, y: secondControlY });
        assert.equal(secondHit?.controlId, 'second');

        node.collapsed = true;
        const collapsedHit = nodeUi.hitTestControl({ x: bodyLeft, y: firstControlY });
        assert.equal(collapsedHit, null);
    });

    it('toggles collapsed state via handleClick and emits updateNode patches', () => {
        const node = createNode({
            controls: [{ id: 'n', type: 'number', label: 'N', default: 1 }],
            controlValues: { n: 3 },
            collapsed: false,
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);
        const canvas = document.createElement('canvas');

        const firstClick = nodeUi.handleClick(
            {
                x: node.x + node.width - COLLAPSE_BUTTON_SIZE + 1,
                y: node.y + 2,
            },
            canvas,
            { pan: { x: 0, y: 0 }, zoom: 1 }
        );

        assert.equal(firstClick, true);
        assert.equal(node.collapsed, true);
        assert.equal(graph.updateCalls.at(-1).patch.collapsed, true);

        const secondClick = nodeUi.handleClick(
            {
                x: node.x + node.width - COLLAPSE_BUTTON_SIZE + 1,
                y: node.y + 2,
            },
            canvas,
            { pan: { x: 0, y: 0 }, zoom: 1 }
        );

        assert.equal(secondClick, true);
        assert.equal(node.collapsed, false);
        assert.equal(graph.updateCalls.at(-1).patch.collapsed, false);
    });

    it('updates visible outputs and node height when dropdown affects outputs', () => {
        const node = createNode({
            controls: [
                {
                    id: 'mode',
                    type: 'dropdown',
                    label: 'Mode',
                    default: 'one',
                    affectsOutputs: true,
                    options: [
                        { value: 'one', label: 'One', activeOutputs: ['out1'] },
                        { value: 'three', label: 'Three', activeOutputs: ['out1', 'out2', 'out3'] },
                    ],
                },
            ],
            outputs: [{ id: 'out1' }, { id: 'out2' }, { id: 'out3' }],
            controlValues: { mode: 'one' },
            height: 140,
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);

        assert.equal(nodeUi.getConnectors('output').length, 1);

        node.controlValues.mode = 'three';
        nodeUi.onControlChanged('mode', 'three', 'one');

        assert.equal(nodeUi.getConnectors('output').length, 3);
        const lastUpdate = graph.updateCalls.at(-1);
        assert.ok(typeof lastUpdate?.patch?.height === 'number');
    });

    it('shows and hides a control editor using public editor lifecycle methods', () => {
        const node = createNode({
            controls: [{ id: 'num', type: 'number', label: 'Number', default: 5 }],
            controlValues: { num: 5 },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            canvasToScreen: (point) => point,
        });

        const bounds = {
            x: node.x + NODE_BODY_PADDING,
            y: node.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING,
            width: 80,
            height: CONTROL_HEIGHT,
        };

        const canvas = document.createElement('canvas');
        document.body.appendChild(canvas);

        nodeUi.showControlEditor(
            'num',
            { x: bounds.x, y: bounds.y },
            canvas,
            { pan: { x: 0, y: 0 }, zoom: 1 },
            bounds,
            false
        );

        const editorInput = document.body.querySelector('input[type="number"]');
        assert.ok(editorInput);

        nodeUi.hideEditor();

        const removedEditorInput = document.body.querySelector('input[type="number"]');
        assert.equal(removedEditorInput, null);
    });

    it('resolves the icon control type to IconControlUi only', () => {
        const node = createNode({
            controls: [{ id: 'icn', type: 'icon', label: 'Icon', default: 'mdi:lightbulb' }],
            controlValues: { icn: 'mdi:lightbulb' },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);

        assert.equal(nodeUi._getControlClassForType('icon'), IconControlUi);
        assert.equal(nodeUi._getControlClassForType('text'), TextControlUi);
        assert.equal(nodeUi._getControlClassForType('nonsense'), null);
    });

    it('renders the icon picker inside the control editor and removes it on hide', () => {
        const node = createNode({
            controls: [{ id: 'icn', type: 'icon', label: 'Icon', default: 'mdi:lightbulb' }],
            controlValues: { icn: 'mdi:lightbulb' },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            canvasToScreen: (point) => point,
        });

        const bounds = {
            x: node.x + NODE_BODY_PADDING,
            y: node.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING,
            width: 120,
            height: CONTROL_HEIGHT,
        };

        const canvas = document.createElement('canvas');
        document.body.appendChild(canvas);

        nodeUi.showControlEditor(
            'icn',
            { x: bounds.x, y: bounds.y },
            canvas,
            { pan: { x: 0, y: 0 }, zoom: 1 },
            bounds,
            false
        );

        const editorInput = document.body.querySelector('.icon-control input[type="text"]');
        const popover = document.body.querySelector('.icon-control__popover');

        assert.ok(editorInput);
        assert.ok(popover);
        // `showControlEditor()` focuses the input, so the picker is already open.
        assert.equal(popover.hidden, false);
        assert.equal(editorInput.value, 'mdi:lightbulb');
        assert.equal(popover.closest('.icon-control'), editorInput.closest('.icon-control'));

        nodeUi.hideEditor();

        assert.equal(document.body.querySelector('.icon-control__popover'), null);
    });

    it('uses stacked control geometry for hit testing and editor bounds', () => {
        const node = createNode({
            controls: [
                {
                    id: 'stackedText',
                    type: 'text',
                    label: 'Stacked Label',
                    layout: 'stacked',
                    default: 'value',
                },
            ],
            controlValues: { stackedText: 'value' },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            canvasToScreen: (point) => point,
        });

        const rowTopY = node.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING;
        const valueRowTopY = rowTopY + CONTROL_HEIGHT + CONTROL_SPACING;
        const controlX = node.x + CONNECTOR_ROW_INSET + 8;

        const labelHit = nodeUi.hitTestControl({ x: controlX, y: rowTopY + 2 });
        assert.equal(labelHit?.controlId, 'stackedText');

        const valueHit = nodeUi.hitTestControl({ x: controlX, y: valueRowTopY + 2 });
        assert.equal(valueHit?.controlId, 'stackedText');
        assert.equal(valueHit?.bounds.x, node.x + CONNECTOR_ROW_INSET);
        assert.equal(valueHit?.bounds.y, valueRowTopY);
        assert.equal(valueHit?.bounds.width, node.width - CONNECTOR_ROW_INSET * 2);
        assert.equal(valueHit?.bounds.height, CONTROL_HEIGHT);

        const canvas = document.createElement('canvas');
        document.body.appendChild(canvas);

        nodeUi.showControlEditor(
            'stackedText',
            { x: controlX, y: valueRowTopY + 2 },
            canvas,
            { pan: { x: 0, y: 0 }, zoom: 1 },
            valueHit?.bounds,
            false
        );

        const editorInput = document.body.querySelector('input[type="text"]');
        assert.ok(editorInput);
        const editorContainer = editorInput.closest('.node-control-ui__wrapper');
        assert.equal(editorContainer?.style.flexDirection, 'column');

        nodeUi.hideEditor();
    });

    it('defaults controls without layout metadata to inline hit-testing geometry', () => {
        const node = createNode({
            controls: [
                {
                    id: 'implicitInline',
                    type: 'text',
                    label: 'Implicit Inline',
                    default: 'value',
                },
                {
                    id: 'explicitInline',
                    type: 'text',
                    label: 'Explicit Inline',
                    layout: 'inline',
                    default: 'value',
                },
            ],
            controlValues: {
                implicitInline: 'value',
                explicitInline: 'value',
            },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            canvasToScreen: (point) => point,
        });

        const rowTopY = node.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING;
        const secondRowTopY = rowTopY + CONTROL_HEIGHT + CONTROL_SPACING;
        const column = nodeUi.getControlColumnLayout();
        const controlX = column.valueX + 4;

        const implicitHit = nodeUi.hitTestControl({ x: controlX, y: rowTopY + 2 });
        assert.equal(implicitHit?.controlId, 'implicitInline');
        assert.equal(
            implicitHit?.bounds.x,
            node.x + CONNECTOR_ROW_INSET + column.labelWidth + CONTROL_LABEL_MARGIN
        );
        assert.equal(implicitHit?.bounds.y, rowTopY);
        assert.equal(implicitHit?.bounds.width, column.valueWidth);
        assert.equal(implicitHit?.bounds.height, CONTROL_HEIGHT);

        const explicitHit = nodeUi.hitTestControl({ x: controlX, y: secondRowTopY + 2 });
        assert.equal(explicitHit?.controlId, 'explicitInline');
        assert.equal(explicitHit?.bounds.x, implicitHit?.bounds.x);
        assert.equal(explicitHit?.bounds.y, secondRowTopY);
        assert.equal(explicitHit?.bounds.width, column.valueWidth);
        assert.equal(explicitHit?.bounds.height, CONTROL_HEIGHT);

        const canvas = document.createElement('canvas');
        document.body.appendChild(canvas);

        nodeUi.showControlEditor(
            'implicitInline',
            { x: controlX, y: rowTopY + 2 },
            canvas,
            { pan: { x: 0, y: 0 }, zoom: 1 },
            implicitHit?.bounds,
            false
        );

        const editorInput = document.body.querySelector('input[type="text"]');
        assert.ok(editorInput);
        const editorContainer = editorInput.closest('.node-control-ui__wrapper');
        assert.equal(editorContainer?.style.flexDirection, 'row');

        nodeUi.hideEditor();
    });

    it('positions connectors below stacked control height', () => {
        const node = createNode({
            controls: [
                {
                    id: 'stackedNumber',
                    type: 'number',
                    label: 'Stacked Number',
                    layout: 'stacked',
                    default: 42,
                },
            ],
            controlValues: { stackedNumber: 42 },
            inputs: [{ id: 'in0', name: 'In' }],
            outputs: [{ id: 'out0', name: 'Out' }],
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);

        const inputConnector = nodeUi.getConnectors('input')[0];
        const expectedY =
            node.y +
            NODE_HEADER_HEIGHT +
            NODE_BODY_PADDING +
            (CONTROL_HEIGHT + CONTROL_SPACING + CONTROL_HEIGHT + CONTROL_SPACING) +
            CONTROLS_CONNECTOR_GAP +
            CONNECTOR_RADIUS;

        assert.equal(inputConnector?.y, expectedY);
    });

    it('positions connectors below controls with omitted layout using inline height', () => {
        const node = createNode({
            controls: [
                {
                    id: 'implicitInlineNumber',
                    type: 'number',
                    label: 'Implicit Inline Number',
                    default: 42,
                },
            ],
            controlValues: { implicitInlineNumber: 42 },
            inputs: [{ id: 'in0', name: 'In' }],
            outputs: [{ id: 'out0', name: 'Out' }],
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);

        const inputConnector = nodeUi.getConnectors('input')[0];
        const expectedY =
            node.y +
            NODE_HEADER_HEIGHT +
            NODE_BODY_PADDING +
            (CONTROL_HEIGHT + CONTROL_SPACING) +
            CONTROLS_CONNECTOR_GAP +
            CONNECTOR_RADIUS;

        assert.equal(inputConnector?.y, expectedY);
    });

    it('hit-tests input default controls when node has no regular controls', () => {
        const node = createNode({
            controls: [],
            inputs: [
                {
                    id: 'title',
                    name: 'Title',
                    defaultControl: { id: 'title', type: 'text', label: 'Title', default: 'Value' },
                },
                { id: 'in0', name: 'Value' },
            ],
            inputDefaults: { title: 'Value' },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);

        const inputY = node.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING + CONNECTOR_RADIUS;
        const controlX = node.x - 5 + CONNECTOR_LABEL_OFFSET;
        const hit = nodeUi.hitTestControl({
            x: controlX + 10,
            y: inputY,
        });

        assert.equal(hit?.controlId, 'title');
        assert.equal(hit?.isInputDefault, true);

        const canvas = document.createElement('canvas');
        document.body.appendChild(canvas);
        nodeUi.showControlEditor(
            'title',
            { x: controlX, y: inputY },
            canvas,
            { pan: { x: 0, y: 0 }, zoom: 1 },
            {
                x: controlX,
                y: inputY - (CONTROL_HEIGHT * INPUT_DEFAULT_CONTROL_FONT_SCALE) / 2,
                width: 80 * INPUT_DEFAULT_CONTROL_FONT_SCALE,
                height: CONTROL_HEIGHT * INPUT_DEFAULT_CONTROL_FONT_SCALE,
            },
            true
        );

        const editorInput = document.body.querySelector('input[type="text"]');
        assert.ok(editorInput);
    });

    it('resizes opposed-row input default controls across narrow/medium/wide node widths', () => {
        const node = createNode({
            width: 220,
            controls: [],
            inputs: [
                {
                    id: 'in0',
                    name: 'Input 0',
                    defaultControl: { id: 'in0', type: 'number', label: 'Input 0', default: 1 },
                },
            ],
            outputs: [{ id: 'out0', name: 'Output 0' }],
            inputDefaults: { in0: 1 },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);

        const outputLabelWidth = measureConnectorLabelWidth('Output 0');
        const widths = [140, 220, 320];
        const measuredWidths = [];

        for (const width of widths) {
            node.width = width;
            nodeUi.invalidateConnectorPositions();

            const inputY = node.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING + CONNECTOR_RADIUS;
            const expectedBounds = getInputDefaultControlBounds({
                nodeX: node.x,
                nodeWidth: node.width,
                inputConnectorX: node.x + CONNECTOR_OVERLAP,
                inputCenterY: inputY,
                rowHasOpposingOutput: true,
                opposingOutputLabelWidth: outputLabelWidth,
                fontScale: INPUT_DEFAULT_CONTROL_FONT_SCALE,
                controlHeight: CONTROL_HEIGHT,
            });

            const probePoint = {
                x: expectedBounds.x + Math.max(1, Math.floor(expectedBounds.width / 2)),
                y: inputY,
            };
            const hit = nodeUi.hitTestControl(probePoint);

            assert.equal(hit?.controlId, 'in0');
            assert.deepEqual(hit?.bounds, expectedBounds);

            measuredWidths.push(expectedBounds.width);

            const outputLabelStart =
                node.x + node.width - CONNECTOR_OVERLAP - CONNECTOR_LABEL_OFFSET - outputLabelWidth;
            const controlRight = expectedBounds.x + expectedBounds.width;

            if (expectedBounds.width > INPUT_DEFAULT_CONTROL_MIN_WIDTH) {
                assert.equal(
                    controlRight,
                    outputLabelStart - CONNECTOR_ROW_RESERVED_GAP,
                    'Opposed row control should stop one gap before the output label'
                );
            } else {
                assert.equal(
                    expectedBounds.width,
                    INPUT_DEFAULT_CONTROL_MIN_WIDTH,
                    'Narrow rows fall back to the minimum control width'
                );
            }
        }

        assert.ok(measuredWidths[0] < measuredWidths[1]);
        assert.ok(measuredWidths[1] < measuredWidths[2]);
    });

    it('reserves only the measured output label width for opposed rows', () => {
        const node = createNode({
            width: 260,
            controls: [],
            inputs: [
                {
                    id: 'in0',
                    name: 'Input 0',
                    defaultControl: { id: 'in0', type: 'number', label: 'Input 0', default: 1 },
                },
            ],
            outputs: [{ id: 'out0', name: 'Out' }],
            inputDefaults: { in0: 1 },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);

        const inputY = node.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING + CONNECTOR_RADIUS;
        const shortLabelBounds = nodeUi.hitTestControl({ x: node.x + 100, y: inputY })?.bounds;

        node.outputs = [{ id: 'out0', name: 'Envelope Follow' }];
        nodeUi.invalidateConnectorPositions();
        nodeUi._invalidateVisibilityCache();
        const longLabelBounds = nodeUi.hitTestControl({ x: node.x + 100, y: inputY })?.bounds;

        assert.ok(shortLabelBounds, 'Control should be hit with the short output label');
        assert.ok(longLabelBounds, 'Control should be hit with the long output label');
        assert.equal(
            shortLabelBounds.width - longLabelBounds.width,
            measureConnectorLabelWidth('Envelope Follow') - measureConnectorLabelWidth('Out')
        );
    });

    it('allows input-only rows to use full available width while opposed rows remain capped', () => {
        const node = createNode({
            width: 260,
            controls: [],
            inputs: [
                {
                    id: 'in0',
                    name: 'Opposed Input',
                    defaultControl: { id: 'in0', type: 'number', label: 'Opposed', default: 1 },
                },
                {
                    id: 'in1',
                    name: 'Input-Only',
                    defaultControl: { id: 'in1', type: 'number', label: 'Input-Only', default: 2 },
                },
            ],
            outputs: [{ id: 'out0', name: 'Output 0' }],
            inputDefaults: { in0: 1, in1: 2 },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);

        const baseY = node.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING + CONNECTOR_RADIUS;
        const opposedBounds = getInputDefaultControlBounds({
            nodeX: node.x,
            nodeWidth: node.width,
            inputConnectorX: node.x + CONNECTOR_OVERLAP,
            inputCenterY: baseY,
            rowHasOpposingOutput: true,
            opposingOutputLabelWidth: measureConnectorLabelWidth('Output 0'),
            fontScale: INPUT_DEFAULT_CONTROL_FONT_SCALE,
            controlHeight: CONTROL_HEIGHT,
        });
        const inputOnlyBounds = getInputDefaultControlBounds({
            nodeX: node.x,
            nodeWidth: node.width,
            inputConnectorX: node.x + CONNECTOR_OVERLAP,
            inputCenterY: baseY + CONNECTOR_SPACING,
            rowHasOpposingOutput: false,
            fontScale: INPUT_DEFAULT_CONTROL_FONT_SCALE,
            controlHeight: CONTROL_HEIGHT,
        });

        assert.ok(inputOnlyBounds.width > opposedBounds.width);

        const inputOnlyHit = nodeUi.hitTestControl({
            x: inputOnlyBounds.x + inputOnlyBounds.width - 1,
            y: baseY + CONNECTOR_SPACING,
        });
        assert.equal(inputOnlyHit?.controlId, 'in1');
    });

    it('draws the input default control with the same bounds it hit-tests', () => {
        const node = createNode({
            width: 140,
            controls: [],
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

        const renderedControlBounds = [];
        nodeUi.inputDefaultControlInstances.set('in0', {
            getLayout: () => ({ height: CONTROL_HEIGHT }),
            renderCanvas: (_ctx, bounds) => renderedControlBounds.push({ ...bounds }),
        });

        const ctx = createRecordingContext();
        nodeUi.draw(ctx);

        assert.equal(renderedControlBounds.length, 1, 'Expected the control to be rendered once');
        const renderedBounds = renderedControlBounds[0];

        assert.ok(renderedBounds.width >= INPUT_DEFAULT_CONTROL_MIN_WIDTH);

        const outputLabelWidth = measureConnectorLabelWidth('Result');
        assert.equal(
            renderedBounds.x + renderedBounds.width,
            node.x +
                node.width -
                CONNECTOR_OVERLAP -
                CONNECTOR_LABEL_OFFSET -
                outputLabelWidth -
                CONNECTOR_ROW_RESERVED_GAP
        );

        const hit = nodeUi.hitTestControl({
            x: renderedBounds.x + renderedBounds.width / 2,
            y: renderedBounds.y + renderedBounds.height / 2,
        });
        assert.equal(hit?.controlId, 'in0');
        assert.deepEqual(hit?.bounds, renderedBounds);

        assert.ok(
            ctx.calls.some((call) => call.type === 'font' && call.value === CONNECTOR_LABEL_FONT),
            'Connector labels are drawn with the measured font'
        );
        const texts = ctx.calls.filter((call) => call.type === 'fillText').map((call) => call.text);
        assert.ok(texts.includes('Result'), 'Output label uses the resolved name');
        assert.ok(!texts.includes('out0'), 'Output label never falls back to the id');
        assert.ok(!texts.includes('in0'), 'Input label never falls back to the id');
    });

    it('keeps connector hit-testing stable after width changes', () => {
        const node = createNode({
            width: 200,
            controls: [],
            inputs: [{ id: 'in0', name: 'Input 0' }],
            outputs: [{ id: 'out0', name: 'Output 0' }],
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id);

        const initialInput = nodeUi.getConnectors('input')[0];
        const initialOutput = nodeUi.getConnectors('output')[0];

        assert.equal(
            nodeUi.hitTestConnector({ x: initialInput.x, y: initialInput.y })?.type,
            'input'
        );
        assert.equal(
            nodeUi.hitTestConnector({ x: initialOutput.x, y: initialOutput.y })?.type,
            'output'
        );

        node.width = 320;
        nodeUi.invalidateConnectorPositions();

        const resizedInput = nodeUi.getConnectors('input')[0];
        const resizedOutput = nodeUi.getConnectors('output')[0];

        assert.equal(resizedInput.x, node.x + CONNECTOR_OVERLAP);
        assert.equal(resizedOutput.x, node.x + node.width - CONNECTOR_OVERLAP);
        assert.equal(
            nodeUi.hitTestConnector({ x: resizedInput.x, y: resizedInput.y })?.type,
            'input'
        );
        assert.equal(
            nodeUi.hitTestConnector({ x: resizedOutput.x, y: resizedOutput.y })?.type,
            'output'
        );
    });
});

/**
 * Recording 2D context for render-path assertions.
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
        closePath() {},
        fill() {},
        stroke() {},
        clip() {},
        fillRect() {},
        drawImage() {},
        moveTo() {},
        lineTo() {},
        translate() {},
        rotate() {},
        scale() {},
        strokeRect() {},
        setLineDash() {},
        arc() {},
        quadraticCurveTo() {},
        bezierCurveTo() {},
        fillText(text, x, y) {
            calls.push({ type: 'fillText', text, x, y });
        },
        measureText(text) {
            return { width: String(text).length * 7 };
        },
        set font(value) {
            this._font = value;
            calls.push({ type: 'font', value });
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
