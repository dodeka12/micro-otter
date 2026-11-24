// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Test: the vars picker row follows the typed companion text while it is typed
 *
 * Typing a new variable name happens in the `customName` text control, while the row the user
 * picked it from is the `name` dropdown, which sits on the `__new__` sentinel and renders the
 * companion text (`displayLabel`). Three things have to hold:
 *
 * 1. the dropdown row follows every keystroke instead of waiting for the editor to close;
 * 2. no control instance is re-created while typing — a rebuild reloads the icon glyph of the
 *    node, which is the flicker a keystroke used to cause in *other* nodes;
 * 3. the row is repainted after the deferred rebuild that lands when the editor closes, so it
 *    cannot keep the frame the placeholder was drawn in.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { createDomHarness } from '../helpers/dom-harness.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { NodeUi } from '../../src/micro_otter/nodes/html/js/nodes/node-ui.js';
import {
    computeControlColumnLayout,
    getControlGeometry,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js';
import {
    CONNECTOR_ROW_INSET,
    CONTROL_HEIGHT,
    CONTROL_SPACING,
    NODE_BODY_PADDING,
    NODE_HEADER_HEIGHT,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js';

const VIEWPORT = { pan: { x: 0, y: 0 }, zoom: 1 };

/**
 * Add a `var-read` node with the picker pair the `vars` package defines.
 * @param {NodeGraph} graph - Graph to add the node to.
 * @param {Record<string, unknown>} controlValues - Stored control values.
 * @returns {object} The added node.
 */
function addVarRead(graph, controlValues = {}) {
    return graph.addNode({
        type: 'vars.var-read',
        x: 100,
        y: 80,
        width: 240,
        height: 200,
        title: 'Variable Read',
        inputs: [
            {
                id: 'store',
                name: 'Store',
                defaultControl: {
                    type: 'dropdown',
                    label: 'Store',
                    default: 'default',
                    affectsControls: true,
                    dynamicOptions: { source: 'varStores', newStoreControls: ['customStore'] },
                },
            },
            { id: 'value', name: 'Default', defaultControl: { type: 'number' } },
        ],
        outputs: [{ id: 'value', name: 'Value' }],
        controls: [
            {
                id: 'name',
                type: 'dropdown',
                label: 'Name',
                default: '',
                affectsControls: true,
                dynamicOptions: {
                    source: 'varNames',
                    dependsOn: ['store'],
                    newNameControls: ['customName'],
                    newLabel: 'Declare variable\u2026',
                },
            },
            { id: 'customStore', type: 'text', label: 'New store', default: '' },
            { id: 'customName', type: 'text', label: 'Variable name', default: '' },
        ],
        controlValues,
        inputDefaults: { store: 'default' },
    });
}

/**
 * Add a node whose controls cross the graph: `availabilityFlags` lists the flags of the
 * collection, so every `node-added` / `node-updated` of the graph asks it to re-resolve.
 * @param {NodeGraph} graph - Graph to add the node to.
 * @returns {object} The added node.
 */
function addSensor(graph) {
    return graph.addNode({
        type: 'hass-sensor',
        x: 100,
        y: 400,
        width: 220,
        height: 180,
        title: 'Sensor',
        controls: [
            { id: 'name', type: 'text', label: 'Name', default: '' },
            { id: 'icon', type: 'icon', label: 'Icon', default: '' },
            {
                id: 'availabilityFlags',
                type: 'multi-dropdown',
                label: 'Availability',
                dynamicOptions: { source: 'availabilityRefs' },
                options: [],
            },
        ],
        inputs: [],
        outputs: [],
        controlValues: { name: 'Kitchen', icon: '' },
        inputDefaults: {},
    });
}

/**
 * Open the editor of one control the way a canvas click does.
 * @param {NodeUi} nodeUi - Node UI that owns the control.
 * @param {HTMLCanvasElement} canvas - Canvas the editor is positioned against.
 * @param {string} controlId - Control to edit.
 * @returns {HTMLInputElement} The mounted editor input.
 */
function openControlEditor(nodeUi, canvas, controlId) {
    const data = nodeUi.getNodeData();
    const bounds = {
        x: data.x + NODE_BODY_PADDING,
        y: data.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING,
        width: 120,
        height: CONTROL_HEIGHT,
    };

    nodeUi.showControlEditor(
        controlId,
        { x: bounds.x, y: bounds.y },
        canvas,
        VIEWPORT,
        bounds,
        false
    );

    const input = document.body.querySelector('.node-control-ui__input--text');
    assert.ok(input, `the editor for "${controlId}" renders an input`);
    return input;
}

/**
 * Type into the mounted editor input, as a user would.
 * @param {HTMLInputElement} input - Editor input.
 * @param {string} value - New input text.
 */
function type(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Row label the picker draws for its current value.
 * @param {NodeUi} nodeUi - Node UI that owns the picker.
 * @param {string} controlId - Picker control id.
 * @returns {string} Label shown on the canvas row.
 */
function rowLabel(nodeUi, controlId) {
    return nodeUi.controlInstances.get(controlId)._displayLabel();
}

/**
 * Rects of the control rows exactly as the renderer stacks them.
 *
 * Mirrors the render path (`node-ui-rendering.ts`): the *resolved* visible control list,
 * one shared label column and `getControlGeometry()` per row.
 * @param {NodeUi} nodeUi - Node UI to measure.
 * @returns {Array<{id: string, bounds: {x: number, y: number, width: number, height: number}}>}
 *   Draw order rects.
 */
function drawnControlRows(nodeUi) {
    const data = nodeUi.getNodeData();
    const visibleControls = nodeUi._getVisibleControls(data);
    const column = computeControlColumnLayout({
        x: data.x,
        width: data.width,
        visibleControls,
        locale: 'en',
    });
    const leftMargin = data.x + CONNECTOR_ROW_INSET;
    const totalWidth = Math.max(0, data.width - CONNECTOR_ROW_INSET * 2);
    let yOffset = data.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING;

    return visibleControls.map((control) => {
        const geometry = getControlGeometry(control, {
            x: leftMargin,
            y: yOffset,
            width: totalWidth,
            controlUi: nodeUi.controlInstances.get(control.id),
            labelWidth: column.labelWidth,
        });
        yOffset += geometry.totalHeight + CONTROL_SPACING;
        return { id: control.id, bounds: geometry.fullBounds };
    });
}

/**
 * Center of one drawn control row.
 * @param {NodeUi} nodeUi - Node UI to measure.
 * @param {string} controlId - Row to locate.
 * @returns {{x: number, y: number}} Point a user click would land on.
 */
function rowCenter(nodeUi, controlId) {
    const row = drawnControlRows(nodeUi).find((entry) => entry.id === controlId);
    assert.ok(row, `row "${controlId}" is drawn`);
    return { x: row.bounds.x + row.bounds.width / 2, y: row.bounds.y + row.bounds.height / 2 };
}

describe('vars picker echo while typing', () => {
    let harness;
    let canvas;

    beforeEach(() => {
        harness = createDomHarness();
        canvas = document.createElement('canvas');
        document.body.appendChild(canvas);
    });

    afterEach(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.cleanup();
    });

    it('updates the name picker row on every keystroke without rebuilding the node', () => {
        const graph = new NodeGraph();
        graph.enableEvents();
        const node = addVarRead(graph, { name: '__new__' });
        const repaints = [];
        const nodeUi = new NodeUi(graph, node.id, {
            canvasToScreen: (point) => point,
            onRepaintRequest: (nodeId) => repaints.push(nodeId),
        });

        assert.equal(rowLabel(nodeUi, 'name'), 'Declare variable\u2026', 'starts on the placeholder');
        const picker = nodeUi.controlInstances.get('name');

        const input = openControlEditor(nodeUi, canvas, 'customName');
        repaints.length = 0;

        type(input, 'h');
        assert.equal(rowLabel(nodeUi, 'name'), 'h', 'the row follows the first keystroke');

        type(input, 'humidity');
        assert.equal(rowLabel(nodeUi, 'name'), 'humidity');
        assert.equal(
            nodeUi.controlInstances.get('name'),
            picker,
            'the picker instance is updated in place, not re-created'
        );
        assert.deepEqual(repaints, [node.id, node.id], 'each keystroke asks for a repainted row');
        assert.equal(graph.getNode(node.id).controlValues.customName, 'humidity');
        assert.equal(
            graph.getNode(node.id).controlValues.name,
            '__new__',
            'the stored value stays on the sentinel'
        );
    });

    it('keeps the echo after the editor closes and repaints the deferred rebuild', () => {
        const graph = new NodeGraph();
        graph.enableEvents();
        const node = addVarRead(graph, { name: '__new__' });
        const repaints = [];
        const nodeUi = new NodeUi(graph, node.id, {
            canvasToScreen: (point) => point,
            onRepaintRequest: (nodeId) => repaints.push(nodeId),
        });

        const input = openControlEditor(nodeUi, canvas, 'customName');
        type(input, 'humidity');
        assert.equal(nodeUi._pendingControlRefresh, true, 'the rebuild is deferred, not dropped');

        repaints.length = 0;
        nodeUi.hideEditor();

        assert.equal(nodeUi._pendingControlRefresh, false);
        assert.deepEqual(repaints, [node.id], 'the flush repaints the row it just rebuilt');
        assert.equal(rowLabel(nodeUi, 'name'), 'humidity', 'the fresh instance carries the name');
        const sentinel = nodeUi.controlInstances
            .get('name')
            .controlData.options.find((option) => option.value === '__new__');
        assert.equal(sentinel.displayLabel, 'humidity');
        assert.equal(sentinel.label, 'Declare variable\u2026', 'the menu keeps the placeholder text');
    });

    it('echoes a typed store namespace on the store picker', () => {
        const graph = new NodeGraph();
        graph.enableEvents();
        const node = addVarRead(graph, {});
        graph.updateNode(node.id, { inputDefaults: { store: '__new__' } });
        const nodeUi = new NodeUi(graph, node.id, { canvasToScreen: (point) => point });

        const storePicker = nodeUi.inputDefaultControlInstances.get('store');
        const input = openControlEditor(nodeUi, canvas, 'customStore');

        type(input, 'presets');

        assert.equal(storePicker._displayLabel(), 'presets');
        assert.equal(
            nodeUi.inputDefaultControlInstances.get('store'),
            storePicker,
            'the store picker is updated in place'
        );
    });

    it('leaves the icon row of another node untouched while a name is typed', () => {
        const graph = new NodeGraph();
        graph.enableEvents();
        const varNode = addVarRead(graph, {});
        const sensor = addSensor(graph);
        const varUi = new NodeUi(graph, varNode.id, { canvasToScreen: (point) => point });
        const sensorUi = new NodeUi(graph, sensor.id, { canvasToScreen: (point) => point });

        assert.equal(sensorUi._hasCrossNodeControl(), true, 'the sensor refreshes on graph events');
        const icon = sensorUi.controlInstances.get('icon');

        const input = openControlEditor(varUi, canvas, 'customName');
        type(input, 'humidity');

        assert.equal(
            sensorUi.controlInstances.get('icon'),
            icon,
            'an unrelated keystroke does not re-create the icon control'
        );
        assert.equal(sensorUi._pendingControlRefresh, false);
    });

    it('opens the companion editor when the drawn New-variable row is clicked', () => {
        const graph = new NodeGraph();
        graph.enableEvents();
        const node = addVarRead(graph, { name: '__new__' });
        const nodeUi = new NodeUi(graph, node.id, { canvasToScreen: (point) => point });

        // The picker sits on the sentinel, so only the companion is drawn — the store
        // companion stays hidden. The status quo of the raw option list had no
        // `activeControls` at all, so it kept all three rows and every row below the
        // picker was hit one slot off.
        assert.deepEqual(
            nodeUi._getVisibleControls(nodeUi.getNodeData()).map((control) => control.id),
            ['name', 'customName'],
            'only the companion of the selected option is drawn'
        );

        const point = rowCenter(nodeUi, 'customName');
        assert.equal(
            nodeUi.hitTestControl(point)?.controlId,
            'customName',
            'a click on the drawn companion row addresses the companion, not a hidden sibling'
        );

        assert.equal(nodeUi.handleClick(point, canvas, VIEWPORT), true);
        const input = document.body.querySelector('.node-control-ui__input--text');
        assert.equal(
            input,
            nodeUi.controlInstances.get('customName').inputElement,
            'the mounted editor is the companion text field'
        );

        type(input, 'humidity');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        const stored = graph.getNode(node.id).controlValues;
        assert.equal(stored.customName, 'humidity', 'the typed name is stored on the companion');
        assert.notEqual(
            stored.customStore,
            'humidity',
            'the hidden store field never receives the text'
        );
        assert.equal(rowLabel(nodeUi, 'name'), 'humidity', 'the picker row echoes the typed name');

        // The input-default rows below the picker are positioned from the same control
        // section height, so the store picker is clickable again (it used to sit one row
        // lower than its connector and matched no rectangle at all).
        const [storeRow] = nodeUi._connectorPositions('input');
        const storeHit = nodeUi.hitTestControl({ x: storeRow.x + 60, y: storeRow.y });
        assert.equal(storeHit?.controlId, 'store', 'the drawn store row hits the store picker');
        assert.equal(storeHit?.isInputDefault, true, 'and it is reported as an input default');
    });
});
