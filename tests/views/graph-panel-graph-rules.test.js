// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Graph-panel graph-rule integration tests.
 *
 * The panel is the only place that turns the graph settings into the `GraphRuleContext` the
 * package graph rules read. These tests pin two things: that the settings reach the rules in their
 * normalized form, and that editing a setting re-runs validation so a badge never outlives the
 * problem it reports.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { AppEventEmitter } from '../../src/micro_otter/nodes/html/js/core/app-event-emitter.js';
import { AppPayload } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import {
    clearGraphRules,
    registerGraphRule,
} from '../../src/micro_otter/nodes/html/js/core/graph-rule-registry.js';
import NodeData from '../../src/micro_otter/nodes/html/js/data/node-data.js';
import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';
import { registerGraphRules as registerVarsGraphRules } from '../../src/micro_otter/nodes/device/node_pkgs/vars/node_capabilities.js';
import { registerGraphRules as registerIrqGraphRules } from '../../src/micro_otter/nodes/device/node_pkgs/irq/node_capabilities.js';

/** Payload for `NodeGraph.ExecutionTypeChanged.v1`, mirroring the data-layer class. */
class NodeGraphExecutionTypeChangedPayload extends AppPayload {
    constructor(graphId, executionType) {
        super('NodeGraph.ExecutionTypeChanged.v1');
        this.graphId = graphId;
        this.executionType = executionType;
    }
}

/** Payload for `NodeGraph.TriggerNameChanged.v1`, mirroring the data-layer class. */
class NodeGraphTriggerNameChangedPayload extends AppPayload {
    constructor(graphId, triggerName) {
        super('NodeGraph.TriggerNameChanged.v1');
        this.graphId = graphId;
        this.triggerName = triggerName;
    }
}

/** Payload for `NodeGraph.SignalTriggerChanged.v1`, mirroring the data-layer class. */
class NodeGraphSignalTriggerChangedPayload extends AppPayload {
    constructor(graphId, signalNames, signalMode, runOnStart) {
        super('NodeGraph.SignalTriggerChanged.v1');
        this.graphId = graphId;
        this.signalNames = signalNames;
        this.signalMode = signalMode;
        this.runOnStart = runOnStart;
    }
}

/** Payload for `NodeGraph.IntervalChanged.v1`, mirroring the data-layer class. */
class NodeGraphIntervalChangedPayload extends AppPayload {
    constructor(graphId, triggerIntervalMs) {
        super('NodeGraph.IntervalChanged.v1');
        this.graphId = graphId;
        this.triggerIntervalMs = triggerIntervalMs;
    }
}

/** Payload for `NodeGraph.EnabledChanged.v1`, mirroring the data-layer class. */
class NodeGraphEnabledChangedPayload extends AppPayload {
    constructor(graphId, enabled) {
        super('NodeGraph.EnabledChanged.v1');
        this.graphId = graphId;
        this.enabled = enabled;
    }
}

/**
 * Minimal `NodeGraph` stand-in that emits the real change events.
 *
 * Settings are stored raw (no normalizing) so a test can prove the panel — not the graph —
 * normalizes what the rules read.
 */
class GraphStub extends AppEventEmitter {
    constructor({ settings = {}, nodes = [] } = {}) {
        super();
        this.id = 'graph-1';
        this._nodes = new Map(nodes.map((node) => [node.getId(), node]));
        this._executionType = settings.executionType ?? 'startup';
        this._triggerName = settings.triggerName ?? '';
        this._signalNames = settings.signalNames ?? [];
        this._signalMode = settings.signalMode ?? 'any';
        this._runOnStart = settings.runOnStart ?? true;
        this._intervalMs = settings.triggerIntervalMs ?? 1000;
        this._enabled = settings.enabled ?? true;
    }

    getName() {
        return 'Graph 1';
    }

    getId() {
        return this.id;
    }

    getNodeIds() {
        return Array.from(this._nodes.keys());
    }

    getNode(nodeId) {
        return this._nodes.get(nodeId) ?? null;
    }

    getNodes() {
        return Array.from(this._nodes.values());
    }

    getConnections() {
        return [];
    }

    getExecutionType() {
        return this._executionType;
    }

    getTriggerName() {
        return this._triggerName;
    }

    getSignalNames() {
        return this._signalNames;
    }

    getSignalMode() {
        return this._signalMode;
    }

    getRunOnStart() {
        return this._runOnStart;
    }

    getTriggerIntervalMs() {
        return this._intervalMs;
    }

    isEnabled() {
        return this._enabled;
    }

    setExecutionType(executionType) {
        this._executionType = executionType;
        this.emit('executionType', new NodeGraphExecutionTypeChangedPayload(this.id, executionType));
    }

    setTriggerName(triggerName) {
        this._triggerName = triggerName;
        this.emit('triggerName', new NodeGraphTriggerNameChangedPayload(this.id, triggerName));
    }

    setSignalNames(signalNames) {
        this._signalNames = signalNames;
        this.emit(
            'signalTrigger',
            new NodeGraphSignalTriggerChangedPayload(
                this.id,
                signalNames,
                this._signalMode,
                this._runOnStart
            )
        );
    }

    setTriggerIntervalMs(triggerIntervalMs) {
        this._intervalMs = triggerIntervalMs;
        this.emit('interval', new NodeGraphIntervalChangedPayload(this.id, triggerIntervalMs));
    }

    setEnabled(enabled) {
        this._enabled = enabled;
        this.emit('enabled', new NodeGraphEnabledChangedPayload(this.id, enabled));
    }
}

/** Minimal `Collection` stand-in exposing the graphs the collection rules scan. */
class CollectionStub extends AppEventEmitter {
    constructor({ targetId = 'board-a', graphs = [] } = {}) {
        super();
        this._targetId = targetId;
        this._graphs = graphs;
    }

    getTargetId() {
        return this._targetId;
    }

    getDeviceRuntimeId() {
        return 'general';
    }

    getGraphArray() {
        return this._graphs;
    }

    setGraphs(graphs) {
        this._graphs = graphs;
    }
}

/** Runtime stub: every type resolves and the target declares no pins. */
function createRuntime() {
    return {
        getNodeType(typeId) {
            return { type: typeId };
        },
        getDeviceTarget() {
            return { capabilityToPins: {}, generalCapabilities: {}, metadata: {} };
        },
    };
}

/**
 * Create a panel wired to stubs, with rendering neutralized.
 * @param {object} options - Wiring options.
 * @param {GraphStub} options.graph - Graph stub under test.
 * @param {CollectionStub} options.collection - Collection stub owning the graph.
 * @param {object} [options.runtime] - Runtime stub; defaults to {@link createRuntime}.
 * @returns {GraphPanelView} Panel under test.
 */
function createView({ graph, collection, runtime = createRuntime() }) {
    const view = new GraphPanelView({
        graph,
        collection,
        workspace: {
            runtimeCollection: {
                getRuntime: () => runtime,
                getActiveRuntime: () => runtime,
            },
            getUserTargetConfig: async () => null,
        },
    });
    view.renderPanel = () => {};
    return view;
}

/** Flush the timer queue so the fire-and-forget revalidations settle. */
function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Build a `vars.signal-post` node that produces a signal, or produces nothing when unnamed.
 * @param {string} id - Node id inside its graph.
 * @param {string} [signal] - Published signal name; omit to leave the node unnamed.
 * @returns {NodeData} Node instance ready for the graph stub.
 */
function signalPostNode(id, signal) {
    return new NodeData({
        id,
        type: 'vars.signal-post',
        controlValues: signal === undefined ? {} : { signal },
    });
}

/** Register the vars package rules on a clean registry. */
function useVarsRules() {
    clearGraphRules();
    registerVarsGraphRules(registerGraphRule);
}

beforeEach(useVarsRules);

afterEach(() => {
    clearGraphRules();
});

describe('GraphPanelView graph-rule context', () => {
    it('passes no empty-selection warning when a signal is watched', async () => {
        const node = signalPostNode('node-1', 'radar');
        const graph = new GraphStub({
            settings: { executionType: 'event', signalNames: ['radar'] },
            nodes: [node],
        });
        const view = createView({ graph, collection: new CollectionStub({ graphs: [graph] }) });

        await view.revalidateNodeCapabilities();

        assert.deepEqual(node.getCapabilityIssues(), []);
    });

    it('warns on every node of an event graph with no signals selected', async () => {
        const first = signalPostNode('node-1', 'radar');
        const second = signalPostNode('node-2', 'beacon');
        const graph = new GraphStub({
            settings: { executionType: 'event', signalNames: [] },
            nodes: [first, second],
        });
        const view = createView({ graph, collection: new CollectionStub({ graphs: [graph] }) });

        await view.revalidateNodeCapabilities();

        const reported = [];
        for (const node of [first, second]) {
            const issues = node.getCapabilityIssues();
            assert.equal(issues.length, 1);
            // The rule reports `nodeId: null`; `NodeData.setCapabilityIssues()` re-anchors a
            // graph-level issue on the node that receives it, so both nodes carry the same text.
            assert.equal(issues[0].nodeId, node.getId());
            assert.match(
                String(issues[0].message),
                /This event graph has no signals selected: pick at least one signal in the graph settings\./
            );
            reported.push({ ...issues[0], nodeId: null });
        }

        assert.deepEqual(reported[0], reported[1]);
    });

    it('stays silent outside event mode', async () => {
        for (const executionType of ['startup', 'continuous']) {
            useVarsRules();

            const node = signalPostNode('node-1', 'radar');
            const graph = new GraphStub({
                settings: { executionType, signalNames: [] },
                nodes: [node],
            });
            const view = createView({ graph, collection: new CollectionStub({ graphs: [graph] }) });

            await view.revalidateNodeCapabilities();

            assert.deepEqual(node.getCapabilityIssues(), [], `executionType '${executionType}'`);
        }
    });

    it('reports a watched signal that no node produces', async () => {
        const node = signalPostNode('node-1', 'radar');
        const graph = new GraphStub({
            settings: { executionType: 'event', signalNames: ['ghost'] },
            nodes: [node],
        });
        const collection = new CollectionStub({ graphs: [graph] });
        const view = createView({ graph, collection });

        await view.revalidateNodeCapabilities();

        const issues = node.getCapabilityIssues();
        assert.equal(issues.length, 1);
        assert.match(String(issues[0].message), /'ghost'/);

        // A producer in another graph of the same collection satisfies the rule.
        collection.setGraphs([graph, new GraphStub({ nodes: [signalPostNode('node-9', 'ghost')] })]);
        await view.revalidateNodeCapabilities();

        assert.deepEqual(node.getCapabilityIssues(), []);
    });

    it('clears the badge as soon as the signal is selected, and restores it on removal', async () => {
        const node = signalPostNode('node-1', 'radar');
        const graph = new GraphStub({
            settings: { executionType: 'event', signalNames: [] },
            nodes: [node],
        });
        const view = createView({ graph, collection: new CollectionStub({ graphs: [graph] }) });

        await view.revalidateNodeCapabilities();
        assert.equal(node.getCapabilityIssues().length, 1);

        graph.setSignalNames(['radar']);
        await flush();
        assert.deepEqual(node.getCapabilityIssues(), []);

        graph.setSignalNames([]);
        await flush();
        assert.equal(node.getCapabilityIssues().length, 1);
    });

    it('normalizes the raw settings before the rules read them', async () => {
        const captured = [];
        registerGraphRule({
            id: 'test-capture-settings',
            scope: 'graph',
            run: ({ graphSettings }) => {
                captured.push(graphSettings);
                return [];
            },
        });

        const graph = new GraphStub({
            settings: {
                executionType: '  event  ',
                triggerName: '  button  ',
                signalNames: [' radar ', ' ', 7, 'radar'],
                signalMode: '  ALL ',
                runOnStart: 'false',
            },
        });
        const view = createView({ graph, collection: new CollectionStub({ graphs: [graph] }) });

        await view.revalidateNodeCapabilities();

        assert.equal(captured.length, 1);
        assert.deepEqual(captured[0], {
            executionType: 'event',
            triggerName: 'button',
            signalNames: ['radar', '7'],
            signalMode: 'all',
            runOnStart: false,
        });
    });

    it('revalidates when the execution type, trigger name or signal trigger changes', async () => {
        let runs = 0;
        registerGraphRule({
            id: 'test-count-runs',
            scope: 'graph',
            run: () => {
                runs += 1;
                return [];
            },
        });

        const graph = new GraphStub();
        const view = createView({ graph, collection: new CollectionStub({ graphs: [graph] }) });

        await view.revalidateNodeCapabilities();
        runs = 0;

        graph.setExecutionType('event');
        await flush();
        assert.equal(runs, 1, 'executionType revalidates');

        graph.setTriggerName('button');
        await flush();
        assert.equal(runs, 2, 'triggerName revalidates');

        graph.setSignalNames(['radar']);
        await flush();
        assert.equal(runs, 3, 'signalTrigger revalidates');

        // Toolbar-only mirrors must not trigger a validation pass.
        graph.setTriggerIntervalMs(500);
        graph.setEnabled(false);
        await flush();
        assert.equal(runs, 3, 'interval and enabled do not revalidate');
    });

    it('trusts the irq trigger name once the graph carries it', async () => {
        registerIrqGraphRules(registerGraphRule);

        const node = new NodeData({
            id: 'node-1',
            type: 'irq.interrupt-input',
            controlValues: { triggerName: 'button' },
        });
        const graph = new GraphStub({
            settings: { executionType: 'irq', triggerName: '' },
            nodes: [node],
        });
        const view = createView({ graph, collection: new CollectionStub({ graphs: [graph] }) });

        await view.revalidateNodeCapabilities();
        assert.equal(node.getCapabilityIssues().length, 1);

        graph.setTriggerName('button');
        await flush();
        assert.deepEqual(node.getCapabilityIssues(), []);
    });
});
