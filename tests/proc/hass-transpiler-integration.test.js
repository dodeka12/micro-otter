import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

const packageRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/hass');
const definitionsPath = path.join(packageRoot, 'node_definitions.json');
const generatorsPath = path.join(packageRoot, 'node_generators.js');

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
    constructor({ id, type, inputs = [], outputs = [], controls = [], controlValues = {}, inputDefaults = {} }) {
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
        this.nodeDefinitions.set(type, { ...definition, packageId: 'hass' });
    }
}

describe('hass central-init transpiler integration', () => {
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
        await import(`${url.href}?test=hass-transpiler-integration`);
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

    function buildNode(runtime, type, id, controlValues = {}, inputDefaults = {}) {
        const definition = runtime.getNodeDefinition(type);
        return new MockNodeData({
            id,
            type,
            inputs: (definition.inputs || []).map((input) => ({ ...input })),
            outputs: (definition.outputs || []).map((output) => ({ ...output })),
            controls: (definition.controls || []).map((control) => ({ ...control })),
            controlValues,
            inputDefaults,
        });
    }

    async function transpile() {
        const runtime = buildRuntime();
        const collection = new MockCollection('hass-col', '1.0.0');
        const graph = new MockNodeGraph('hass-graph', 'HassGraph');

        graph.addNode(
            'b1',
            buildNode(runtime, 'hass-bridge', 'b1', {
                deviceId: 'otter-kitchen',
                deviceName: 'Kitchen',
                discoveryPrefix: 'homeassistant',
                topicPrefix: 'otter',
            })
        );
        graph.addNode(
            's1',
            buildNode(runtime, 'hass-sensor', 's1', {
                objectId: 'temperature',
                name: 'Temperature',
                deviceClass: 'temperature',
                unit: 'C',
            })
        );
        graph.addNode(
            'n1',
            buildNode(runtime, 'hass-number', 'n1', { objectId: 'target' })
        );
        collection.addGraph('hass-graph', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        return result.code;
    }

    it('emits one init_mqtt with the bridge configuration first', async () => {
        const code = await transpile();

        assert.equal(code.split('async def init_mqtt').length - 1, 1);
        assert.equal(code.split('_mqtt.start()').length - 1, 1);
        assert.ok(code.includes('from otter_hass import runtime as _hass'));
        assert.ok(code.includes("device_id='otter-kitchen'"));
        assert.ok(code.indexOf('_hass.configure(') < code.indexOf('_mqtt.start()'));
    });

    it('registers every entity and publishes both states', async () => {
        const code = await transpile();

        assert.equal(code.split("_hass.register_entity('sensor', 'temperature'").length - 1, 1);
        assert.equal(code.split("_hass.register_entity('number', 'target'").length - 1, 1);
        assert.ok(code.includes("_hass.publish_state('sensor', 'temperature'"));
        assert.ok(code.includes("_hass.publish_state('number', 'target'"));
        // The bridge loop is a comment, which the transpiler strips: no poll_birth() remains.
        assert.ok(!code.includes('_hass.poll_birth()'));
    });

    async function transpileAdverseOrder() {
        const runtime = buildRuntime();
        const collection = new MockCollection('hass-col', '1.0.0');

        // Adversarial order: the entity graph is registered before the bridge graph, so a
        // priority-less transpiler would emit register_entity() above configure().
        const entities = new MockNodeGraph('entities', 'Entities');
        entities.addNode(
            's1',
            buildNode(runtime, 'hass-sensor', 's1', {
                objectId: 'temperature',
                name: 'Temperature',
                deviceClass: 'temperature',
                unit: 'C',
            })
        );
        entities.addNode('n1', buildNode(runtime, 'hass-number', 'n1', { objectId: 'target' }));

        const startup = new MockNodeGraph('startup', 'Startup');
        startup.addNode(
            'b1',
            buildNode(runtime, 'hass-bridge', 'b1', {
                deviceId: 'otter-kitchen',
                deviceName: 'Kitchen',
                discoveryPrefix: 'homeassistant',
                topicPrefix: 'otter',
            })
        );

        collection.addGraph('entities', entities);
        collection.addGraph('startup', startup);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        return result.code;
    }

    it('orders configure before register_entity even when the bridge graph comes second', async () => {
        const code = await transpileAdverseOrder();

        assert.equal(code.split('async def init_mqtt').length - 1, 1);
        assert.equal(code.split('_mqtt.start()').length - 1, 1);

        const configureIdx = code.indexOf('_hass.configure(');
        const sensorIdx = code.indexOf("_hass.register_entity('sensor'");
        const numberIdx = code.indexOf("_hass.register_entity('number'");
        const startIdx = code.indexOf('_mqtt.start()');

        assert.ok(configureIdx >= 0, 'expected a _hass.configure() call');
        assert.ok(sensorIdx >= 0, 'expected a sensor register_entity() call');
        assert.ok(numberIdx >= 0, 'expected a number register_entity() call');
        assert.ok(configureIdx < sensorIdx, 'configure() must precede the sensor registration');
        assert.ok(configureIdx < numberIdx, 'configure() must precede the number registration');
        assert.ok(numberIdx < startIdx, 'register_entity() must precede _mqtt.start()');

        // The bridge loop is a comment, which the transpiler strips: no poll_birth() remains.
        assert.ok(!code.includes('_hass.poll_birth()'));

        // Both entity loop statements stay in the entity graph.
        assert.ok(code.includes("_hass.publish_state('sensor', 'temperature'"));
        assert.ok(code.includes("_hass.publish_state('number', 'target'"));
    });

    async function transpileWithIcons() {
        const runtime = buildRuntime();
        const collection = new MockCollection('hass-col', '1.0.0');
        const graph = new MockNodeGraph('icons', 'Icons');

        graph.addNode(
            'b1',
            buildNode(runtime, 'hass-bridge', 'b1', { deviceId: 'otter-kitchen' })
        );
        graph.addNode(
            's1',
            buildNode(runtime, 'hass-sensor', 's1', {
                objectId: 'temperature',
                icon: 'mdi:thermometer',
            })
        );
        graph.addNode(
            'b1s',
            buildNode(runtime, 'hass-binary-sensor', 'b1s', {
                objectId: 'motion',
                icon: 'mdi:motion-sensor',
            })
        );
        graph.addNode(
            'n1',
            buildNode(runtime, 'hass-number', 'n1', {
                objectId: 'target',
                icon: 'mdi:thermostat',
            })
        );
        graph.addNode(
            'w1',
            buildNode(runtime, 'hass-switch', 'w1', {
                objectId: 'relay',
                icon: 'mdi:toggle-switch',
            })
        );
        graph.addNode(
            'c1',
            buildNode(runtime, 'hass-select', 'c1', {
                objectId: 'mode',
                icon: 'ph:sliders',
                options: 'low,high',
            })
        );

        collection.addGraph('icons', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        return result.code;
    }

    it('carries the icon of every component into its register_entity config', async () => {
        const code = await transpileWithIcons();

        assert.equal(code.split('async def init_mqtt').length - 1, 1);
        assert.equal(code.split('_mqtt.start()').length - 1, 1);

        [
            ["'sensor', 'temperature'", 'mdi:thermometer'],
            ["'binary_sensor', 'motion'", 'mdi:motion-sensor'],
            ["'number', 'target'", 'mdi:thermostat'],
            ["'switch', 'relay'", 'mdi:toggle-switch'],
            ["'select', 'mode'", 'ph:sliders'],
        ].forEach(([registration, icon]) => {
            const start = code.indexOf(`_hass.register_entity(${registration}`);
            assert.ok(start >= 0, `expected a register_entity call for ${registration}`);

            const end = code.indexOf('\n', start);
            const line = code.slice(start, end === -1 ? undefined : end);
            assert.ok(
                line.includes(`'icon': '${icon}'`),
                `${registration} must carry the icon: ${line}`
            );
        });

        // The select keeps its option list next to the icon.
        assert.ok(code.includes("'icon': 'ph:sliders', 'options': ['low', 'high']"));
    });

    async function transpileWithAvailabilityFlag() {
        const runtime = buildRuntime();
        const collection = new MockCollection('hass-col', '1.0.0');
        const main = new MockNodeGraph('main', 'Main');

        main.addNode(
            'b1',
            buildNode(runtime, 'hass-bridge', 'b1', {
                deviceId: 'otter-kitchen',
                topicPrefix: 'otter',
            })
        );
        main.addNode(
            's1',
            buildNode(runtime, 'hass-sensor', 's1', {
                objectId: 'temperature',
                availabilityFlags: ['__device__', 'heating'],
                availabilityMode: 'all',
            })
        );
        main.addNode(
            'f1',
            buildNode(
                runtime,
                'hass-availability',
                'f1',
                { id: 'heating' },
                { value: true }
            )
        );

        collection.addGraph('main', main);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        return result.code;
    }

    it('emits the availability flag publish loop and the entity flag list', async () => {
        const code = await transpileWithAvailabilityFlag();

        assert.equal(code.split('async def init_mqtt').length - 1, 1);
        assert.equal(code.split('_mqtt.start()').length - 1, 1);
        assert.ok(
            code.includes("_mqtt.register_publish(topic=_hass.availability_topic('heating'), qos=0)")
        );
        assert.ok(
            code.includes("_mqtt.publish_deferred(topic=_hass.availability_topic('heating')")
        );
        assert.ok(code.includes("payload=('online' if (True) else 'offline')"));
        assert.ok(code.includes("retain=True"));
        assert.ok(code.includes("availability=True"));
        assert.ok(code.includes("availability_flags=['heating']"));
        assert.ok(code.includes("availability_mode='all'"));
        // configure() must still run before any topic is derived from it.
        assert.ok(
            code.indexOf('_hass.configure(') <
                code.indexOf("_hass.availability_topic('heating')")
        );
    });
});
