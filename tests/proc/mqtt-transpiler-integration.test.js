import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

const definitionsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/mqtt/node_definitions.json'
);
const generatorsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/mqtt/node_generators.js'
);

class MockCollection {
    constructor(id, version = '1.0.0') {
        this.id = id;
        this.version = version;
        this.graphs = new Map();
    }

    getId() {
        return this.id;
    }

    getVersion() {
        return this.version;
    }

    getGraphs() {
        const result = {};
        this.graphs.forEach((graph, id) => {
            result[id] = graph;
        });
        return result;
    }

    addGraph(id, graph) {
        this.graphs.set(id, graph);
    }
}

class MockNodeGraph {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.nodes = new Map();
        this.connections = [];
    }

    getId() {
        return this.id;
    }

    getName() {
        return this.name;
    }

    getNodes() {
        const result = {};
        this.nodes.forEach((node, id) => {
            result[id] = node;
        });
        return result;
    }

    getConnections() {
        return this.connections.slice();
    }

    addNode(id, node) {
        this.nodes.set(id, node);
    }

    addConnection(connection) {
        this.connections.push({ ...connection });
    }
}

class MockNodeData {
    constructor({
        id,
        type,
        inputs = [],
        outputs = [],
        controls = [],
        controlValues = {},
        inputDefaults = {},
    }) {
        this.id = id;
        this.type = type;
        this.title = type;
        this.inputs = inputs;
        this.outputs = outputs;
        this.controls = controls;
        this.controlValues = controlValues;
        this.inputDefaults = inputDefaults;
    }

    getId() {
        return this.id;
    }

    getType() {
        return this.type;
    }

    getTitle() {
        return this.title;
    }
}

class MockDeviceRuntime {
    constructor() {
        this.nodeDefinitions = new Map();
    }

    getNodeDefinition(type) {
        return this.nodeDefinitions.get(type);
    }

    addNodeDefinition(type, definition) {
        this.nodeDefinitions.set(type, { ...definition, packageId: 'mqtt' });
    }
}

describe('mqtt central-init transpiler integration', () => {
    let originalSelf;
    let originalWindow;
    let originalNodeCodeGenerators;
    let originalNodeInitGenerators;

    before(async () => {
        originalSelf = globalThis.self;
        originalWindow = globalThis.window;
        originalNodeCodeGenerators = globalThis.NodeCodeGenerators;
        originalNodeInitGenerators = globalThis.NodeInitGenerators;
        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        globalThis.NodeInitGenerators = {};
        const url = pathToFileURL(generatorsPath);
        await import(`${url.href}?test=mqtt-transpiler-integration`);
    });

    after(() => {
        if (originalSelf === undefined) delete globalThis.self;
        else globalThis.self = originalSelf;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalNodeCodeGenerators === undefined) delete globalThis.NodeCodeGenerators;
        else globalThis.NodeCodeGenerators = originalNodeCodeGenerators;
        if (originalNodeInitGenerators === undefined) delete globalThis.NodeInitGenerators;
        else globalThis.NodeInitGenerators = originalNodeInitGenerators;
    });

    function loadNodeTypes() {
        return JSON.parse(readFileSync(definitionsPath, 'utf8')).nodeTypes;
    }

    function buildRuntime() {
        const nodeTypes = loadNodeTypes();
        const runtime = new MockDeviceRuntime();
        Object.keys(nodeTypes).forEach((type) => runtime.addNodeDefinition(type, nodeTypes[type]));
        return runtime;
    }

    function buildNode(runtime, type, id, { controlValues = {}, inputDefaults = {} } = {}) {
        const definition = runtime.getNodeDefinition(type);
        return new MockNodeData({
            id,
            type,
            // The definition's own connector objects are required: the transpiler
            // derives the Python default literal from input.defaultControl.default.
            inputs: (definition.inputs || []).map((input) => ({ ...input })),
            outputs: (definition.outputs || []).map((output) => ({ ...output })),
            controls: (definition.controls || []).map((control) => ({ ...control })),
            controlValues,
            inputDefaults,
        });
    }

    function writeControls(topic) {
        return { topic, qos: 0, retain: false, publishMode: 'on-change' };
    }

    function buildCollection(runtime) {
        const collection = new MockCollection('col', '1.0.0');

        const readGraph = new MockNodeGraph('graphA', 'ReadGraph');
        readGraph.addNode(
            'n1',
            buildNode(runtime, 'mqtt-read', 'n1', {
                controlValues: {
                    topic: 'sensors/temp',
                    qos: 0,
                    valueType: 'float',
                    jsonKey: '',
                    defaultWhenDisconnected: false,
                },
            })
        );
        readGraph.addNode(
            'n2',
            buildNode(runtime, 'mqtt-read', 'n2', {
                controlValues: {
                    topic: 'sensors/temp',
                    qos: 0,
                    valueType: 'float',
                    jsonKey: 'v',
                    defaultWhenDisconnected: true,
                },
                inputDefaults: { default: 2.5 },
            })
        );
        ['n3', 'n5', 'n6', 'n7'].forEach((id) => {
            readGraph.addNode(
                id,
                buildNode(runtime, 'mqtt-write', id, {
                    controlValues: writeControls(`actuators/${id}`),
                })
            );
        });
        readGraph.addConnection({ fromNode: 'n1', fromIndex: 0, toNode: 'n3', toIndex: 1 });
        readGraph.addConnection({ fromNode: 'n1', fromIndex: 1, toNode: 'n5', toIndex: 1 });
        readGraph.addConnection({ fromNode: 'n2', fromIndex: 0, toNode: 'n6', toIndex: 1 });
        readGraph.addConnection({ fromNode: 'n2', fromIndex: 1, toNode: 'n7', toIndex: 1 });
        collection.addGraph('graphA', readGraph);

        const statusGraph = new MockNodeGraph('graphB', 'StatusGraph');
        statusGraph.addNode('n4', buildNode(runtime, 'mqtt-status', 'n4'));
        statusGraph.addNode(
            'n8',
            buildNode(runtime, 'mqtt-write', 'n8', {
                controlValues: writeControls('actuators/status'),
            })
        );
        statusGraph.addConnection({ fromNode: 'n4', fromIndex: 0, toNode: 'n8', toIndex: 1 });
        collection.addGraph('graphB', statusGraph);

        return collection;
    }

    async function transpileReferenceCollection() {
        const runtime = buildRuntime();
        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(buildCollection(runtime), {
            deviceRuntime: runtime,
        });
        return result.code;
    }

    it('derives a single init_mqtt with subscriptions and publishes before start', async () => {
        const code = await transpileReferenceCollection();

        assert.equal(code.split('async def init_mqtt').length - 1, 1);
        assert.equal(code.split('_mqtt.start()').length - 1, 1);
        assert.ok(code.includes('import otter_mqtt.runtime as _mqtt'));
        assert.ok(code.includes("_mqtt.register_subscription(topic='sensors/temp', qos=0)"));
        assert.ok(code.includes("_mqtt.register_publish(topic='actuators/n3', qos=0)"));
        assert.ok(code.indexOf('_mqtt.register_subscription') < code.indexOf('_mqtt.start()'));
        assert.ok(code.indexOf('_mqtt.register_publish') < code.indexOf('_mqtt.start()'));
    });

    it('emits sticky typed reads with per-node cursors and defaults', async () => {
        const code = await transpileReferenceCollection();

        assert.ok(!code.includes('_mqtt.take_latest('));
        assert.ok(!code.includes('_mqtt.coerce('));
        assert.ok(code.includes('_mqtt.latest_value('));
        assert.ok(code.includes('_mqtt.take_updated('));
        assert.ok(code.includes('default=(0)'));
        assert.ok(code.includes('default=(2.5)'));
        assert.ok(code.includes("key='_mqtt_read_n1'"));
        assert.ok(code.includes("key='_mqtt_read_n2'"));
        assert.ok(code.includes('require_connected=False'));
        assert.ok(code.includes('require_connected=True'));
        assert.ok(code.includes('= _mqtt.is_connected()'));
    });

    async function transpileJsonStoreGraph() {
        const runtime = buildRuntime();
        const collection = new MockCollection('col-json', '1.0.0');
        const graph = new MockNodeGraph('graphJson', 'JsonGraph');
        graph.addNode(
            'r1',
            buildNode(runtime, 'mqtt-read', 'r1', {
                controlValues: {
                    topic: 'state/in',
                    qos: 0,
                    valueType: 'string',
                    jsonKey: '',
                    defaultWhenDisconnected: false,
                    payloadMode: 'json-store',
                    storeNamespace: 'sensors',
                },
            })
        );
        graph.addNode(
            'w1',
            buildNode(runtime, 'mqtt-write', 'w1', {
                controlValues: {
                    topic: 'state/out',
                    qos: 0,
                    retain: true,
                    publishMode: 'on-change',
                    payloadMode: 'json-store',
                    storeNamespace: 'sensors',
                },
            })
        );
        graph.addConnection({ fromNode: 'r1', fromIndex: 1, toNode: 'w1', toIndex: 1 });
        collection.addGraph('graphJson', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        return result.code;
    }

    it('round-trips a vars namespace through one JSON payload', async () => {
        const code = await transpileJsonStoreGraph();

        assert.ok(code.includes("_store.replace('sensors', _mqtt_json_r1)"));
        assert.ok(code.includes("_mqtt.json_payload(_store.items('sensors'))"));
        assert.equal(code.split('import otter_vars.store as _store').length - 1, 1);
        assert.ok(code.includes("_mqtt.register_publish(topic='state/out', qos=0)"));
        assert.ok(code.includes("_mqtt.register_subscription(topic='state/in', qos=0)"));
    });

    async function transpileNodes(specs) {
        const runtime = buildRuntime();
        const collection = new MockCollection('col-nodes', '1.0.0');
        const graph = new MockNodeGraph('graphNodes', 'NodesGraph');
        specs.forEach((spec) => {
            graph.addNode(
                spec.id,
                buildNode(runtime, spec.type, spec.id, {
                    controlValues: spec.controlValues || {},
                    inputDefaults: spec.inputDefaults || {},
                })
            );
        });
        collection.addGraph('graphNodes', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        return result.code;
    }

    it('configures the will before the runtime starts', async () => {
        const code = await transpileNodes([
            { id: 'w1', type: 'mqtt-will', controlValues: { willTopic: 'home/status' } },
            { id: 'w2', type: 'mqtt-will', controlValues: { willTopic: 'home/status' } },
            { id: 'r1', type: 'mqtt-read', controlValues: { topic: 'home/temp', qos: 0 } },
        ]);

        assert.equal(
            code.split("_mqtt.configure_will(topic='home/status'").length - 1,
            1,
            'two identically configured will nodes must contribute one call'
        );
        assert.ok(
            code.indexOf('_mqtt.configure_will(') < code.indexOf('_mqtt.start()'),
            'the will must be configured before the client connects'
        );
    });

    it('guards an mqtt write with the stored enabled default', async () => {
        const code = await transpileNodes([
            {
                id: 'w1',
                type: 'mqtt-write',
                controlValues: {
                    topic: 'home/off',
                    qos: 0,
                    retain: true,
                    publishMode: 'on-change',
                },
                inputDefaults: { enabled: false },
            },
        ]);

        assert.ok(
            code.replace(/\s+/g, ' ').includes("if bool(False): _mqtt.publish(topic='home/off'"),
            'the publish must sit under the disabled guard'
        );
        assert.ok(
            code.includes("_mqtt.register_publish(topic='home/off', qos=0)"),
            'init-time registration must stay unconditional'
        );
    });

    it('subscribes the announce trigger next to a read node on the same topic', async () => {
        const runtime = buildRuntime();
        const collection = new MockCollection('col-announce', '1.0.0');
        const graph = new MockNodeGraph('graphAnnounce', 'AnnounceGraph');
        graph.addNode(
            'a1',
            buildNode(runtime, 'mqtt-announce', 'a1', {
                controlValues: {
                    announceTopic: 'home/announce',
                    payload: 'online',
                    triggerTopic: 'homeassistant/status',
                    triggerValue: 'online',
                },
            })
        );
        graph.addNode(
            'r1',
            buildNode(runtime, 'mqtt-read', 'r1', {
                controlValues: { topic: 'homeassistant/status', qos: 0 },
            })
        );
        graph.addNode(
            'w1',
            buildNode(runtime, 'mqtt-write', 'w1', {
                controlValues: { topic: 'home/echo', qos: 0 },
            })
        );
        graph.addConnection({ fromNode: 'r1', fromIndex: 0, toNode: 'w1', toIndex: 1 });
        collection.addGraph('graphAnnounce', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const code = (await transpiler.transpile(collection, { deviceRuntime: runtime })).code;

        assert.ok(
            code.includes("_mqtt.register_subscription(topic='homeassistant/status', qos=0)")
        );
        assert.ok(code.includes("key='_mqtt_announce_trig_a1'"));
        assert.ok(code.includes("key='_mqtt_read_r1'"));
        assert.ok(code.includes("_mqtt.publish_deferred(topic='home/announce'"));
    });
});
