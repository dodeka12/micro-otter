import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createDomHarness } from '../helpers/dom-harness.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { NodeUi } from '../../src/micro_otter/nodes/html/js/nodes/node-ui.js';
import {
    CONTROL_HEIGHT,
    NODE_BODY_PADDING,
    NODE_HEADER_HEIGHT,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js';

const VIEWPORT = { pan: { x: 0, y: 0 }, zoom: 1 };

/**
 * Build a node whose control set needs a dynamic refresh: `availabilityFlags` resolves its
 * options from other nodes, which makes every `node-updated` a reason to re-create the
 * control instances.
 * @returns {{graph: NodeGraph, nodeId: string, nodeUi: NodeUi, canvas: HTMLCanvasElement}}
 *   Fresh graph, node UI and the canvas the editor is positioned against.
 */
function createFixture() {
    const graph = new NodeGraph();
    graph.enableEvents();

    const node = graph.addNode({
        type: 'hass-sensor',
        x: 100,
        y: 80,
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

    const nodeUi = new NodeUi(graph, node.id, { canvasToScreen: (point) => point });
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);

    return { graph, nodeId: node.id, nodeUi, canvas };
}

/**
 * Open the control editor the way a canvas click does and return its input.
 * @param {NodeUi} nodeUi - Node UI that owns the control.
 * @param {HTMLCanvasElement} canvas - Canvas the editor is anchored in.
 * @param {string} controlId - Control to edit.
 * @returns {HTMLInputElement} The mounted editor input.
 */
function openEditor(nodeUi, canvas, controlId) {
    const bounds = {
        x: 100 + NODE_BODY_PADDING,
        y: 80 + NODE_HEADER_HEIGHT + NODE_BODY_PADDING,
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
 * Press Backspace in the mounted editor input and apply its effect.
 * @param {HTMLInputElement} input - Editor input.
 */
function backspace(input) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    type(input, input.value.slice(0, -1));
}

/**
 * Add an availability flag node: a real reason for the sensor's `availabilityFlags` list to
 * change, i.e. a `node-added` the option resolution cannot ignore.
 * @param {NodeGraph} graph - Graph to add the flag to.
 * @param {string} flagId - Flag id the new node publishes.
 * @returns {void}
 */
function addAvailabilityFlag(graph, flagId) {
    graph.addNode({
        type: 'hass-availability',
        x: 420,
        y: 80,
        width: 160,
        height: 120,
        title: 'Availability',
        controls: [{ id: 'id', type: 'text', label: 'Flag', default: '' }],
        inputs: [],
        outputs: [],
        controlValues: { id: flagId },
        inputDefaults: {},
    });
}

describe('NodeUi open control editor', () => {
    let harness;

    beforeEach(() => {
        harness = createDomHarness();
    });

    afterEach(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.cleanup();
    });

    it('stays attached while an edit makes the graph emit node-updated', () => {
        const { graph, nodeId, nodeUi, canvas } = createFixture();
        assert.equal(nodeUi._hasCrossNodeControl(), true, 'the fixture refreshes on graph events');

        const input = openEditor(nodeUi, canvas, 'name');
        const instance = nodeUi.controlInstances.get('name');

        type(input, 'Patio');

        assert.equal(graph.getNode(nodeId).controlValues.name, 'Patio');
        assert.equal(input.isConnected, true, 'the editor is not torn down by the refresh');
        assert.equal(document.body.querySelector('.node-control-ui__input--text'), input);
        assert.equal(nodeUi.controlInstances.get('name'), instance, 'no instance swap mid-edit');

        // A keystroke that changes no option list does not even schedule a rebuild: rebuilding
        // would re-create every control of the node (the icon row reloads its glyph).
        assert.equal(nodeUi._pendingControlRefresh, false);

        // A flag node really does extend the availability list, so that one is deferred.
        addAvailabilityFlag(graph, 'online');

        assert.equal(nodeUi._pendingControlRefresh, true, 'the rebuild is deferred, not dropped');
        assert.equal(nodeUi.controlInstances.get('name'), instance, 'still no mid-edit swap');

        backspace(input);

        assert.equal(graph.getNode(nodeId).controlValues.name, 'Pati');
        assert.equal(input.isConnected, true, 'Backspace keeps the editor attached');
        assert.equal(input.value, 'Pati');
    });

    it('applies the deferred rebuild once the editor closes', () => {
        const { graph, nodeUi, canvas } = createFixture();
        const repaints = [];
        nodeUi._onRepaintRequest = (id) => repaints.push(id);
        const input = openEditor(nodeUi, canvas, 'name');
        const instance = nodeUi.controlInstances.get('name');

        addAvailabilityFlag(graph, 'online');

        assert.equal(nodeUi._pendingControlRefresh, true);
        assert.equal(nodeUi.controlInstances.get('name'), instance);

        nodeUi.hideEditor();

        assert.equal(input.isConnected, false);
        assert.equal(document.body.querySelector('.node-control-ui__input--text'), null);
        assert.equal(nodeUi._pendingControlRefresh, false);
        assert.notEqual(
            nodeUi.controlInstances.get('name'),
            instance,
            'the deferred rebuild re-creates the instances'
        );
        assert.deepEqual(
            repaints,
            [nodeUi.nodeId],
            'the row the user edited is repainted after the deferred rebuild'
        );
    });

    it('keeps the instances of an unrelated graph update', () => {
        const { graph, nodeUi } = createFixture();
        const instances = [...nodeUi.controlInstances.entries()];
        const repaints = [];
        nodeUi._onRepaintRequest = (id) => repaints.push(id);

        graph.updateNode(nodeUi.nodeId, { title: 'Sensor 2' });

        assert.deepEqual(
            [...nodeUi.controlInstances.entries()],
            instances,
            'a title change does not re-create the controls'
        );
        assert.equal(nodeUi._pendingControlRefresh, false);
        assert.deepEqual(repaints, []);
    });

    it('drops the editor and rebuilds whenever the graph is swapped', () => {
        const { graph, nodeId, nodeUi, canvas } = createFixture();
        const input = openEditor(nodeUi, canvas, 'icon');
        const instance = nodeUi.controlInstances.get('icon');

        nodeUi.setGraph(graph, nodeId);

        assert.equal(input.isConnected, false);
        assert.equal(nodeUi._pendingControlRefresh, false);
        assert.ok(nodeUi.controlInstances.get('icon'), 'instances exist after the swap');
        assert.notEqual(nodeUi.controlInstances.get('icon'), instance);
    });
});
