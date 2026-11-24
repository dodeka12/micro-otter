import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createDomHarness } from '../helpers/dom-harness.js';
import { NodeUi } from '../../src/micro_otter/nodes/html/js/nodes/node-ui.js';
import { NodeDropdownControlUi } from '../../src/micro_otter/nodes/html/js/nodes/controls/index.js';

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
            if (nodeId !== node.id) {
                return;
            }
            if (patch.controlValues) {
                node.controlValues = { ...patch.controlValues };
            }
            Object.assign(node, patch);
        },
    };
}

function stubTarget() {
    return {
        getPinsForCapability(key) {
            return key === 'digital.input' ? [1, 2, 3] : null;
        },
        getPinCapability(pin) {
            const pins = {
                1: { label: 'GPIO1', pull: ['up', 'down'] },
                2: { label: 'GPIO2', pull: ['down'], fixedPull: 'down' },
                3: { label: 'GPIO3', pull: [] },
            };
            return Object.prototype.hasOwnProperty.call(pins, pin) ? pins[pin] : null;
        },
        resources: {},
    };
}

function createDynamicNode() {
    return createNode({
        controls: [
            {
                id: 'pin',
                type: 'dropdown',
                label: 'Pin',
                default: 1,
                dynamicOptions: {
                    source: 'targetPinsForCapability',
                    capabilityKey: 'digital.input',
                },
            },
            {
                id: 'pull',
                type: 'dropdown',
                label: 'Pull',
                default: null,
                dynamicOptions: {
                    source: 'targetPinPull',
                    dependsOn: ['pin'],
                    includeUndefined: true,
                },
            },
        ],
        controlValues: { pin: 1, pull: null },
    });
}

describe('NodeUi dynamic control resolution', () => {
    let harness;

    beforeEach(() => {
        harness = createDomHarness();
    });

    afterEach(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.cleanup();
    });

    it('resolves dynamic dropdown options and disabled state at init', () => {
        const node = createDynamicNode();
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            resolveDeviceTarget: () => stubTarget(),
        });

        const pinControl = nodeUi.controlInstances.get('pin');
        assert.ok(pinControl instanceof NodeDropdownControlUi);
        assert.deepEqual(
            pinControl.controlData.options.map((option) => option.value),
            [1, 2, 3]
        );

        const pullControl = nodeUi.controlInstances.get('pull');
        assert.deepEqual(
            pullControl.controlData.options.map((option) => option.value),
            [null, 'up', 'down']
        );
        assert.equal(pullControl.controlData.disabled, false);
    });

    it('re-resolves dependent controls when pin changes', () => {
        const node = createDynamicNode();
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            resolveDeviceTarget: () => stubTarget(),
        });

        node.controlValues.pin = 2;
        nodeUi.onControlChanged('pin', 2, 1);

        const pullControl = nodeUi.controlInstances.get('pull');
        assert.equal(pullControl.controlData.disabled, true);
        assert.deepEqual(
            pullControl.controlData.options.map((option) => option.value),
            ['down']
        );
        assert.equal(node.controlValues.pull, 'down');
    });

    it('renders empty and disabled options when no target is available', () => {
        const node = createDynamicNode();
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            resolveDeviceTarget: () => null,
        });

        const pinControl = nodeUi.controlInstances.get('pin');
        assert.deepEqual(pinControl.controlData.options, []);
        assert.equal(pinControl.controlData.disabled, true);
    });

    it('disables i2sId when the target has no i2s controllers', () => {
        const node = createNode({
            controls: [
                {
                    id: 'i2sId',
                    type: 'dropdown',
                    label: 'I2S Peripheral',
                    default: 0,
                    dynamicOptions: {
                        source: 'targetResourceValues',
                        resourceGroup: 'i2s',
                        resourceKey: 'controllers',
                    },
                },
            ],
            controlValues: { i2sId: 0 },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            resolveDeviceTarget: () => ({ resources: {} }),
        });

        const control = nodeUi.controlInstances.get('i2sId');
        assert.equal(control.controlData.disabled, true);
        assert.deepEqual(control.controlData.options, []);
    });

    it('lists controller ids when the target has i2s controllers', () => {
        const node = createNode({
            controls: [
                {
                    id: 'i2sId',
                    type: 'dropdown',
                    label: 'I2S Peripheral',
                    default: 0,
                    dynamicOptions: {
                        source: 'targetResourceValues',
                        resourceGroup: 'i2s',
                        resourceKey: 'controllers',
                    },
                },
            ],
            controlValues: { i2sId: 0 },
        });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            resolveDeviceTarget: () => ({ resources: { i2s: { controllers: 2 } } }),
        });

        const control = nodeUi.controlInstances.get('i2sId');
        assert.equal(control.controlData.disabled, false);
        assert.deepEqual(
            control.controlData.options.map((option) => option.value),
            [0, 1]
        );
    });
});

function createTopicNode(overrides = {}) {
    return createNode({
        id: 'node-topic',
        type: 'mqtt-write',
        controls: [
            {
                id: 'topic',
                type: 'dropdown',
                label: 'Topic',
                default: '',
                affectsControls: true,
                dynamicOptions: { source: 'graphTopics', newTopicControls: ['customTopic'] },
            },
            { id: 'customTopic', type: 'text', label: 'New topic' },
            { id: 'qos', type: 'dropdown', label: 'QoS', default: 0 },
        ],
        controlValues: { topic: '' },
        ...overrides,
    });
}

function createEmittingGraph(nodes, { withOff = true } = {}) {
    const listeners = new Map();
    const graph = {
        nodes,
        on(name, handler) {
            const list = listeners.get(name) || [];
            list.push(handler);
            listeners.set(name, list);
        },
        getNodes() {
            return nodes;
        },
        getNode(nodeId) {
            return nodes.find((entry) => entry.id === nodeId) || null;
        },
        getConnections() {
            return [];
        },
        getConnectionsForNode() {
            return [];
        },
        updateNode(nodeId, patch) {
            const target = nodes.find((entry) => entry.id === nodeId);
            if (!target) {
                return;
            }
            if (patch.controlValues) {
                target.controlValues = { ...patch.controlValues };
            }
            Object.assign(target, patch);
        },
        emit(name) {
            (listeners.get(name) || []).forEach((handler) => handler({ nodeId: 'other' }));
        },
        listenerCount(name) {
            return (listeners.get(name) || []).length;
        },
    };
    if (withOff) {
        graph.off = (name, handler) => {
            const list = listeners.get(name) || [];
            listeners.set(
                name,
                list.filter((entry) => entry !== handler)
            );
        };
    }
    return graph;
}

function topicPublisher(id, topic) {
    return createNode({
        id,
        type: 'mqtt-read',
        controls: [{ id: 'topic', type: 'dropdown' }],
        controlValues: { topic },
    });
}

function createSignalNode(overrides = {}) {
    return createNode({
        id: 'node-signal',
        type: 'vars.signal-post',
        controls: [
            {
                id: 'signal',
                type: 'dropdown',
                label: 'Signal',
                default: '',
                affectsControls: true,
                dynamicOptions: {
                    source: 'signalNames',
                    newNameControls: ['customSignal'],
                    newLabel: { en: 'Define signal…', de: 'Signal definieren…' },
                },
            },
            { id: 'customSignal', type: 'text', label: 'Signal name', default: '' },
            { id: 'once', type: 'checkbox', label: 'Only on rising edge', default: true },
        ],
        controlValues: { signal: '' },
        ...overrides,
    });
}

describe('graphTopics control visibility', () => {
    let harness;

    beforeEach(() => {
        harness = createDomHarness();
    });

    afterEach(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.cleanup();
    });

    it('reveals the custom topic control while the topic is unset', () => {
        const node = createTopicNode();
        const graph = createEmittingGraph([node, topicPublisher('publisher', 'home/temp')]);
        const nodeUi = new NodeUi(graph, node.id);

        const visible = nodeUi._getVisibleControls(node).map((control) => control.id);
        assert.deepEqual(visible, ['topic', 'customTopic', 'qos']);
        assert.equal(node.controlValues.topic, '__new__');
    });

    it('hides the custom topic control once a graph topic is selected', () => {
        const node = createTopicNode({ controlValues: { topic: 'home/temp' } });
        const graph = createEmittingGraph([node, topicPublisher('publisher', 'home/temp')]);
        const nodeUi = new NodeUi(graph, node.id);

        assert.deepEqual(
            nodeUi._getVisibleControls(node).map((control) => control.id),
            ['topic', 'qos']
        );
        const options = nodeUi.controlInstances.get('topic').controlData.options;
        assert.ok(options.some((option) => option.value === 'home/temp'));
        assert.ok(options.some((option) => option.value === '__new__'));
    });

    it('reveals the custom topic control again after choosing the sentinel', () => {
        const node = createTopicNode({ controlValues: { topic: 'home/temp' } });
        const graph = createEmittingGraph([node, topicPublisher('publisher', 'home/temp')]);
        const nodeUi = new NodeUi(graph, node.id);

        node.controlValues.topic = '__new__';
        nodeUi.onControlChanged('topic', '__new__', 'home/temp');

        assert.deepEqual(
            nodeUi._getVisibleControls(node).map((control) => control.id),
            ['topic', 'customTopic', 'qos']
        );
    });

    it('hides only the controls a static dropdown declares', () => {
        const node = createNode({
            controls: [
                {
                    id: 'operation',
                    type: 'dropdown',
                    affectsControls: true,
                    default: 'sin',
                    options: [
                        { value: 'sin', label: 'sin', activeControls: ['angleUnit'] },
                        { value: 'add', label: 'add', activeControls: [] },
                    ],
                },
                { id: 'angleUnit', type: 'dropdown', default: 'rad' },
                { id: 'operand', type: 'number', default: 0 },
            ],
            controlValues: { operation: 'add' },
        });
        const graph = createEmittingGraph([node]);
        const nodeUi = new NodeUi(graph, node.id);

        assert.deepEqual(
            nodeUi._getVisibleControls(node).map((control) => control.id),
            ['operation', 'operand']
        );

        node.controlValues.operation = 'sin';
        nodeUi.onControlChanged('operation', 'sin', 'add');
        assert.deepEqual(
            nodeUi._getVisibleControls(node).map((control) => control.id),
            ['operation', 'angleUnit', 'operand']
        );
    });

    it('hides nothing for an affecting dropdown without activeControls', () => {
        const node = createNode({
            controls: [
                {
                    id: 'mode',
                    type: 'dropdown',
                    affectsControls: true,
                    default: 'a',
                    options: [
                        { value: 'a', label: 'A' },
                        { value: 'b', label: 'B' },
                    ],
                },
                { id: 'extra', type: 'text', default: '' },
            ],
            controlValues: { mode: 'a' },
        });
        const graph = createEmittingGraph([node]);
        const nodeUi = new NodeUi(graph, node.id);

        assert.deepEqual(
            nodeUi._getVisibleControls(node).map((control) => control.id),
            ['mode', 'extra']
        );
    });

    it('returns the same node data when no control is dynamic', () => {
        const node = createNode({
            controls: [{ id: 'mode', type: 'text', default: '' }],
            controlValues: {},
        });
        const graph = createEmittingGraph([node]);
        const nodeUi = new NodeUi(graph, node.id);

        assert.equal(nodeUi._visibilityNodeData(node), node);
    });
});

describe('signalNames control visibility', () => {
    let harness;

    beforeEach(() => {
        harness = createDomHarness();
    });

    afterEach(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.cleanup();
    });

    it('reveals the custom signal control after choosing Define signal', () => {
        const node = createSignalNode();
        const graph = createEmittingGraph([node]);
        const nodeUi = new NodeUi(graph, node.id);

        assert.deepEqual(
            nodeUi._getVisibleControls(node).map((control) => control.id),
            ['signal', 'once']
        );

        node.controlValues.signal = '__new__';
        nodeUi.onControlChanged('signal', '__new__', '');

        assert.deepEqual(
            nodeUi._getVisibleControls(node).map((control) => control.id),
            ['signal', 'customSignal', 'once']
        );
        assert.equal(node.controlValues.signal, '__new__');
        const sentinels = nodeUi.controlInstances
            .get('signal')
            .controlData.options.filter((option) => option.value === '__new__');
        assert.equal(sentinels.length, 1);
    });

    it('hides the custom signal control when (not set) is selected', () => {
        const node = createSignalNode({
            controlValues: { signal: '__new__', customSignal: 'motion' },
        });
        const graph = createEmittingGraph([node]);
        const nodeUi = new NodeUi(graph, node.id);

        assert.deepEqual(
            nodeUi._getVisibleControls(node).map((control) => control.id),
            ['signal', 'customSignal', 'once']
        );

        node.controlValues.signal = '';
        nodeUi.onControlChanged('signal', '', '__new__');

        assert.deepEqual(
            nodeUi._getVisibleControls(node).map((control) => control.id),
            ['signal', 'once']
        );
    });
});

describe('constant node mode visibility', () => {
    let harness;

    beforeEach(() => {
        harness = createDomHarness();
    });

    afterEach(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.cleanup();
    });

    /**
     * Build a node shaped like the core constant node.
     * @param {object} controlValues - Stored control values.
     * @returns {object} Node data.
     */
    function createConstantNode(controlValues = {}) {
        return createNode({
            id: 'constant-1',
            type: 'const',
            controls: [
                {
                    id: 'valueMode',
                    type: 'dropdown',
                    default: 'custom',
                    affectsControls: true,
                    options: [
                        {
                            value: 'custom',
                            activeControls: [
                                'valueType',
                                'floatValue',
                                'intValue',
                                'boolValue',
                                'stringValue',
                            ],
                        },
                        { value: 'special', activeControls: ['specialValue'] },
                    ],
                },
                {
                    id: 'valueType',
                    type: 'dropdown',
                    default: 'float',
                    affectsControls: true,
                    options: [
                        { value: 'float', activeControls: ['floatValue'] },
                        { value: 'int', activeControls: ['intValue'] },
                        { value: 'bool', activeControls: ['boolValue'] },
                        { value: 'string', activeControls: ['stringValue'] },
                    ],
                },
                { id: 'floatValue', type: 'number', default: 50 },
                { id: 'intValue', type: 'number', default: 50 },
                { id: 'boolValue', type: 'checkbox', default: false },
                { id: 'stringValue', type: 'text', default: 'Hello' },
                { id: 'specialValue', type: 'dropdown', default: 'pi' },
            ],
            controlValues,
        });
    }

    /**
     * @param {object} node - Node data.
     * @returns {string[]} Visible control ids.
     */
    function visibleIds(node) {
        const nodeUi = new NodeUi(createEmittingGraph([node]), node.id);
        return nodeUi._getVisibleControls(node).map((control) => control.id);
    }

    it('shows the value control of the selected custom type', () => {
        assert.deepEqual(visibleIds(createConstantNode({ valueMode: 'custom', valueType: 'int' })), [
            'valueMode',
            'valueType',
            'intValue',
        ]);
        assert.deepEqual(visibleIds(createConstantNode({ valueType: 'string' })), [
            'valueMode',
            'valueType',
            'stringValue',
        ]);
    });

    it('intersects both affecting dropdowns in special mode', () => {
        assert.deepEqual(
            visibleIds(
                createConstantNode({
                    valueMode: 'special',
                    valueType: 'int',
                    specialValue: 'e',
                })
            ),
            ['valueMode', 'specialValue']
        );
    });

    it('restores the custom value control after switching back', () => {
        const node = createConstantNode({ valueMode: 'special', valueType: 'bool' });
        const nodeUi = new NodeUi(createEmittingGraph([node]), node.id);

        assert.deepEqual(
            nodeUi._getVisibleControls(node).map((control) => control.id),
            ['valueMode', 'specialValue']
        );

        node.controlValues.valueMode = 'custom';
        nodeUi.onControlChanged('valueMode', 'custom', 'special');

        assert.deepEqual(
            nodeUi._getVisibleControls(node).map((control) => control.id),
            ['valueMode', 'valueType', 'boolValue']
        );
    });
});

describe('graphTopics refresh on graph changes', () => {
    function topicOptionValues(nodeUi) {
        return nodeUi.controlInstances
            .get('topic')
            .controlData.options.map((option) => option.value);
    }

    it('refreshes the dropdown when another node adds a topic', () => {
        const node = createTopicNode();
        const nodes = [node];
        const graph = createEmittingGraph(nodes);
        const nodeUi = new NodeUi(graph, node.id);

        assert.deepEqual(topicOptionValues(nodeUi), ['', '__new__']);

        nodes.push(topicPublisher('publisher', 'a/b'));
        graph.emit('node-added');

        assert.deepEqual(topicOptionValues(nodeUi), ['', 'a/b', '__new__']);
    });

    it('refreshes the dropdown when the publishing node disappears', () => {
        const node = createTopicNode();
        const publisher = topicPublisher('publisher', 'a/b');
        const nodes = [node, publisher];
        const graph = createEmittingGraph(nodes);
        const nodeUi = new NodeUi(graph, node.id);

        assert.deepEqual(topicOptionValues(nodeUi), ['', 'a/b', '__new__']);

        nodes.pop();
        graph.emit('node-removed');

        assert.deepEqual(topicOptionValues(nodeUi), ['', '__new__']);
    });

    it('stops refreshing after the graph is unbound', () => {
        const node = createTopicNode();
        const nodes = [node];
        const graph = createEmittingGraph(nodes);
        const nodeUi = new NodeUi(graph, node.id);

        let refreshes = 0;
        const originalRefresh = nodeUi._refreshDynamicControls.bind(nodeUi);
        nodeUi._refreshDynamicControls = () => {
            refreshes += 1;
            originalRefresh();
        };

        graph.emit('node-added');
        assert.equal(refreshes, 1);

        nodeUi.setGraph(null, node.id);
        nodes.push(topicPublisher('publisher', 'a/b'));
        graph.emit('node-added');

        assert.equal(refreshes, 1);
        assert.equal(graph.listenerCount('node-added'), 0);
    });

    it('registers listeners on a graph without off support', () => {
        const node = createTopicNode();
        const graph = createEmittingGraph([node], { withOff: false });
        const nodeUi = new NodeUi(graph, node.id);

        assert.equal(graph.listenerCount('node-added'), 1);
        assert.equal(graph.listenerCount('node-updated'), 1);
        assert.equal(graph.listenerCount('node-removed'), 1);
        assert.doesNotThrow(() => nodeUi.setGraph(null, node.id));
    });

    it('terminates a re-entrant refresh after exactly one pass', () => {
        const node = createTopicNode();
        const nodes = [node];
        const graph = createEmittingGraph(nodes);
        const nodeUi = new NodeUi(graph, node.id);

        let passes = 0;
        const originalInit = nodeUi._initializeControls.bind(nodeUi);
        nodeUi._initializeControls = () => {
            originalInit();
            passes += 1;
            if (passes < 5) {
                graph.emit('node-updated');
            }
        };

        // A real option-list change: an event that resolves to the same lists does not rebuild
        // (and therefore has nothing to re-enter).
        nodes.push(topicPublisher('publisher', 'a/b'));
        graph.emit('node-added');

        assert.equal(passes, 1);
    });
});



