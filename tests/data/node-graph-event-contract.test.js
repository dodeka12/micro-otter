import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assertAppEventPayloadType } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { ViewportConfig } from '../../src/micro_otter/nodes/html/js/data/viewport-config.js';

describe('NodeGraph event contract', () => {
    it('emits typed AppEvent payload for graph rename', () => {
        const graph = new NodeGraph({ id: 'graph-1', name: 'Original' });
        let received = null;

        graph.on('*', (event) => {
            if (event.name === 'name') {
                received = event;
            }
        });

        graph.setName('Renamed');

        assert.ok(received);
        const validated = assertAppEventPayloadType(
            received,
            'NodeGraph.NameChanged.v1',
            'NodeGraph listener'
        );
        assert.equal(validated.detail.graphId, 'graph-1');
        assert.equal(validated.detail.name, 'Renamed');
        assert.equal(received.type, undefined);
    });

    it('emits typed payload for node position changes', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const node = graph.addNode({ type: 'test-node', x: 10, y: 20 });
        let received = null;

        graph.on('*', (event) => {
            if (event.name === 'node-pos-changed') {
                received = event;
            }
        });

        graph.updateNodePosition(node.id, 30, 40);

        assert.ok(received);
        const validated = assertAppEventPayloadType(
            received,
            'NodeGraph.NodePositionChanged.v1',
            'NodeGraph listener'
        );
        assert.equal(validated.detail.nodeId, node.id);
        assert.equal(validated.detail.x, 30);
        assert.equal(validated.detail.y, 40);
    });

    it('emits typed payload for connection add/remove', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const source = graph.addNode({
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'float' }],
        });
        const target = graph.addNode({
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['float'] }],
        });

        const events = [];
        graph.on('*', (event) => {
            if (event.name === 'connection-added' || event.name === 'connection-removed') {
                events.push(event);
            }
        });

        graph.addConnection({
            fromNode: source.id,
            fromIndex: 0,
            toNode: target.id,
            toIndex: 0,
        });
        graph.removeConnection(source.id, 0, target.id, 0);

        assert.equal(events.length, 2);
        assertAppEventPayloadType(
            events[0],
            'NodeGraph.ConnectionAdded.v1',
            'NodeGraph listener'
        );
        assertAppEventPayloadType(
            events[1],
            'NodeGraph.ConnectionRemoved.v1',
            'NodeGraph listener'
        );
    });

    it('defaults the enabled flag to true and round-trips an explicit false', () => {
        const defaulted = new NodeGraph({ id: 'graph-1', name: 'Graph 1' });
        assert.equal(defaulted.getEnabled(), true);

        const restored = NodeGraph.fromData({ id: 'graph-2', name: 'Graph 2' });
        assert.equal(restored.getEnabled(), true);

        const serialized = new NodeGraph({ id: 'graph-3', enabled: false }).toData();
        assert.equal(serialized.enabled, false);
        assert.equal(NodeGraph.fromData(serialized).getEnabled(), false);
    });

    it('emits one typed payload when the enabled flag changes', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const events = [];

        graph.on('*', (event) => {
            if (event.name === 'enabled') {
                events.push(event);
            }
        });

        graph.setEnabled(false);
        graph.setEnabled(false);

        assert.equal(events.length, 1);
        const validated = assertAppEventPayloadType(
            events[0],
            'NodeGraph.EnabledChanged.v1',
            'NodeGraph listener'
        );
        assert.equal(validated.detail.graphId, 'graph-1');
        assert.equal(validated.detail.enabled, false);
    });

    it('normalizes string input for the enabled flag', () => {
        const graph = new NodeGraph({ id: 'graph-1' });

        graph.setEnabled('false');
        assert.equal(graph.getEnabled(), false);

        graph.setEnabled('true');
        assert.equal(graph.getEnabled(), true);

        graph.setEnabled('anything else');
        assert.equal(graph.getEnabled(), true);
    });

    it('emits one typed payload for viewport changes and clones its input', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const events = [];

        graph.on('*', (event) => {
            if (event.name === 'viewport') {
                events.push(event);
            }
        });

        const config = new ViewportConfig({ translateX: 10, translateY: 20, scale: 1.25 });
        graph.setViewportConfig(config);

        assert.equal(events.length, 1);
        const validated = assertAppEventPayloadType(
            events[0],
            'NodeGraph.ViewportChanged.v1',
            'NodeGraph listener'
        );
        assert.equal(validated.detail.graphId, 'graph-1');
        assert.deepEqual(validated.detail.viewport, {
            translateX: 10,
            translateY: 20,
            scale: 1.25,
        });

        // The model clones its input: mutating the caller's instance neither leaks nor re-emits.
        config.translateX = 999;
        assert.deepEqual(graph.getViewportConfig().toData(), {
            translateX: 10,
            translateY: 20,
            scale: 1.25,
        });
        assert.equal(events.length, 1);

        assert.throws(() => graph.setViewportConfig({ translateX: 10 }), TypeError);
    });

    it('emits one typed payload per signal trigger change', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const events = [];

        graph.on('*', (event) => {
            if (event.name === 'signalTrigger') {
                events.push(event);
            }
        });

        graph.setSignalNames(['radar', 'radar', '']);
        graph.setSignalMode('all');
        graph.setRunOnStart(false);
        graph.setSignalNames(['radar']); // no change, no extra event

        assert.equal(events.length, 3);
        const last = assertAppEventPayloadType(
            events[2],
            'NodeGraph.SignalTriggerChanged.v1',
            'NodeGraph listener'
        );
        assert.equal(last.detail.graphId, 'graph-1');
        assert.deepEqual(last.detail.signalNames, ['radar']);
        assert.equal(last.detail.signalMode, 'all');
        assert.equal(last.detail.runOnStart, false);
    });

    it('round-trips the signal trigger through toData', () => {
        const graph = new NodeGraph({
            id: 'graph-1',
            signalNames: ['radar', 'motion'],
            signalMode: 'all',
            runOnStart: false,
        });
        const data = graph.toData();
        assert.deepEqual(data.signalNames, ['radar', 'motion']);
        assert.equal(data.signalMode, 'all');
        assert.equal(data.runOnStart, false);

        const restored = NodeGraph.fromData(data);
        assert.deepEqual(restored.getSignalNames(), ['radar', 'motion']);
        assert.equal(restored.getSignalMode(), 'all');
        assert.equal(restored.getRunOnStart(), false);
    });
});
