import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateGraphRules } from '../../src/micro_otter/nodes/html/js/core/graph-rule-registry.js';
import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';
import '../../src/micro_otter/nodes/device/node_pkgs/hass/node_capabilities.js';

const examplePath = path.resolve(
    'src/micro_otter/nodes/device/graphs/examples/mqtt-hass-demo.json'
);
const packagesRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs');

// CPython parses the generated MicroPython app, so it catches an empty function body
// (`SyntaxError: invalid syntax`) before the device does. The same code is byte-compiled
// by mpy-cross in `npm run check:device-syntax`, which cannot see generated apps.
const PYTHON_COMPILE_SCRIPT = [
    'import sys',
    "compile(sys.stdin.read(), 'main_loop.py', 'exec')",
    "print('compiled')",
].join('\n');

function loadExample() {
    return JSON.parse(readFileSync(examplePath, 'utf8'));
}

function loadNodeTypes() {
    const index = JSON.parse(readFileSync(path.join(packagesRoot, 'index.json'), 'utf8'));
    const nodeTypes = {};
    index.packages.forEach((entry) => {
        const defsPath = path.join(packagesRoot, entry.id, 'node_definitions.json');
        if (!existsSync(defsPath)) {
            return;
        }
        const definitions = JSON.parse(readFileSync(defsPath, 'utf8')).nodeTypes || {};
        Object.keys(definitions).forEach((typeId) => {
            nodeTypes[`${entry.id}.${typeId}`] = definitions[typeId];
        });
    });
    return nodeTypes;
}

const NODE_META_KEYS = new Set(['title', 'position', 'collapsed', 'inputDefaults']);

describe('mqtt + hass example collection', () => {
    it('ships an Init startup graph and one continuous graph', () => {
        const data = loadExample();

        assert.equal(data.version, 3);
        assert.equal(data.definitionId, 'general');
        assert.equal(data.graphs.length, 2);

        const [init, main] = data.graphs;
        assert.equal(init.name, 'Init');
        assert.equal(init.executionType, 'startup');
        assert.equal(main.executionType, 'continuous');
    });

    it('uses only node types that ship with the packages', () => {
        const nodeTypes = loadNodeTypes();

        loadExample().graphs.forEach((graph) => {
            graph.nodes.forEach((node) => {
                assert.ok(
                    nodeTypes[node.type],
                    `graph '${graph.name}' uses unknown node type '${node.type}'`
                );
            });
        });
    });

    it('wires connections between existing connectors', () => {
        const nodeTypes = loadNodeTypes();

        loadExample().graphs.forEach((graph) => {
            const byId = new Map(graph.nodes.map((node) => [node.id, node]));
            graph.connections.forEach((connection) => {
                const from = byId.get(connection.fromNode);
                const to = byId.get(connection.toNode);
                assert.ok(from, `connection from unknown node ${connection.fromNode}`);
                assert.ok(to, `connection to unknown node ${connection.toNode}`);
                assert.ok(
                    connection.fromIndex < (nodeTypes[from.type].outputs || []).length,
                    `node ${from.id} has no output ${connection.fromIndex}`
                );
                assert.ok(
                    connection.toIndex < (nodeTypes[to.type].inputs || []).length,
                    `node ${to.id} has no input ${connection.toIndex}`
                );
            });
        });
    });
});

describe('mqtt + hass example collection controls', () => {
    it('uses only declared controls and known node meta fields', () => {
        const nodeTypes = loadNodeTypes();

        loadExample().graphs.forEach((graph) => {
            graph.nodes.forEach((node) => {
                const definition = nodeTypes[node.type];
                const declared = new Set((definition.controls || []).map((c) => c.id));
                const inputs = new Set((definition.inputs || []).map((i) => i.id));

                Object.keys(node.controlValues || {}).forEach((controlId) => {
                    assert.ok(
                        declared.has(controlId),
                        `node ${node.id} (${node.type}) sets undeclared control '${controlId}'`
                    );
                });
                Object.keys(node.inputDefaults || {}).forEach((inputId) => {
                    assert.ok(
                        inputs.has(inputId),
                        `node ${node.id} (${node.type}) sets a default for unknown input '${inputId}'`
                    );
                });
                Object.keys(node).forEach((key) => {
                    const known =
                        ['id', 'type', 'controlValues'].includes(key) || NODE_META_KEYS.has(key);
                    assert.ok(known, `node ${node.id} has unexpected field '${key}'`);
                });
            });
        });
    });

    it('reports no graph-rule issues across the collection', () => {
        const nodeTypes = loadNodeTypes();
        const collection = loadExample().graphs.flatMap((graph) => graph.nodes);

        loadExample().graphs.forEach((graph) => {
            const nodeTypesByNodeId = {};
            graph.nodes.forEach((node) => {
                nodeTypesByNodeId[String(node.id)] = nodeTypes[node.type];
            });
            const issues = validateGraphRules({
                graphId: graph.id,
                nodes: graph.nodes,
                nodeTypesByNodeId,
                connections: graph.connections,
                collectionNodes: collection,
            });
            assert.deepEqual(
                issues.map((issue) => `${issue.nodeId}: ${issue.message}`),
                [],
                `graph '${graph.name}' has graph-rule issues`
            );
        });
    });

    it('contains one bridge and at least two entities', () => {
        const nodes = loadExample().graphs.flatMap((graph) => graph.nodes);
        const bridges = nodes.filter((node) => node.type === 'hass.hass-bridge');
        const entities = nodes.filter(
            (node) => node.type.startsWith('hass.') && node.type !== 'hass.hass-bridge'
        );

        assert.equal(bridges.length, 1);
        assert.ok(entities.length >= 2, 'expected at least two hass entities');
    });

    it('demonstrates will, an availability flag and the json-store round trip', () => {
        const nodes = loadExample().graphs.flatMap((graph) => graph.nodes);
        const byType = (type) => nodes.filter((node) => node.type === type);

        // The bridge owns the collection's single will; no separate MQTT Will node remains.
        assert.equal(byType('mqtt.mqtt-will').length, 0);
        const bridge = byType('hass.hass-bridge')[0];
        assert.equal(bridge.controlValues.will, true);
        assert.equal(bridge.controlValues.availability, true);

        // The bridge publishes the retained `online` itself, so the hand-rolled announce that
        // used to repeat it on the same topic is gone.
        assert.equal(byType('mqtt.mqtt-announce').length, 0);

        const flags = byType('hass.hass-availability');
        assert.equal(flags.length, 1);
        assert.equal(flags[0].controlValues.id, 'heating');

        const sensor = byType('hass.hass-sensor')[0];
        assert.deepEqual(sensor.controlValues.availabilityFlags, ['__device__', 'heating']);
        assert.equal(sensor.controlValues.availabilityMode, 'all');
        assert.equal(sensor.controlValues.availability, undefined);

        const select = byType('hass.hass-select')[0];
        assert.deepEqual(select.controlValues.availabilityFlags, ['__device__']);
        assert.equal(select.controlValues.availability, undefined);

        const read = byType('mqtt.mqtt-read')[0];
        const write = byType('mqtt.mqtt-write')[0];
        assert.equal(read.controlValues.payloadMode, 'json-store');
        assert.equal(write.controlValues.payloadMode, 'json-store');
        assert.equal(read.controlValues.storeNamespace, write.controlValues.storeNamespace);
    });

    it('demonstrates both authorities and the write-only control', () => {
        const nodes = loadExample().graphs.flatMap((graph) => graph.nodes);
        const byId = (id) => nodes.find((node) => node.id === id);

        // Device authority: the graph's value wins, an HA change arrives on Command/Updated.
        assert.equal(byId(12).controlValues.authority, 'device');
        assert.equal(byId(12).controlValues.reportState, true);
        assert.equal(byId(13).controlValues.authority, 'device');
        // Write-only control: nothing is published for it.
        assert.equal(byId(14).controlValues.reportState, false);
        // Receive-only: a press is consumed, never published.
        assert.equal(byId(15).controlValues.objectId, 'reset');
        assert.deepEqual(byId(15).outputs, undefined);

        // The entities that predate the control keep the legacy shape (no authority key).
        ['hass.hass-sensor', 'hass.hass-select'].forEach((type) => {
            const entity = nodes.find((node) => node.type === type);
            assert.equal(entity.controlValues.authority, undefined);
        });
    });

    it('feeds the availability flag from a real graph value', () => {
        const nodes = loadExample().graphs.flatMap((graph) => graph.nodes);
        const byType = (type) => nodes.filter((node) => node.type === type);
        const flag = byType('hass.hass-availability')[0];
        const graph = loadExample().graphs.find((entry) =>
            entry.nodes.some((node) => node.id === flag.id && node.type === flag.type)
        );
        const source = graph.connections.find(
            (connection) => connection.toNode === flag.id && connection.toIndex === 1
        );

        assert.ok(source, 'the flag input must be wired');
        const driver = graph.nodes.find((node) => node.id === source.fromNode);
        assert.equal(driver.type, 'core.const');
        assert.equal(driver.controlValues.valueType, 'bool');
    });
});

class MockNodeData {
    constructor(definition, id, node) {
        this.id = String(id);
        this.type = node.type;
        this.title = node.title || node.type;
        this.inputs = (definition.inputs || []).map((input) => ({ ...input }));
        this.outputs = (definition.outputs || []).map((output) => ({ ...output }));
        this.controls = (definition.controls || []).map((control) => ({ ...control }));
        this.controlValues = { ...(node.controlValues || {}) };
        this.inputDefaults = { ...(node.inputDefaults || {}) };
        applyDropdownTypeOverrides(definition, this.controlValues, this);
    }

    getId() {
        return this.id;
    }

    getType() {
        return this.type;
    }
}

/**
 * Mirror `NodeGraph#applyDropdownOptionConnectorTypes`: the app derives a node's connector
 * types from the selected dropdown option, and the demo JSON stores neither.
 */
function applyDropdownTypeOverrides(definition, controlValues, node) {
    (definition.controls || []).forEach((control) => {
        if (control.type !== 'dropdown' || !Array.isArray(control.options)) {
            return;
        }
        const selected = controlValues[control.id];
        const option = control.options.find(
            (candidate) =>
                candidate.value === selected || String(candidate.value) === String(selected)
        );
        if (!option) {
            return;
        }

        node.inputs.forEach((input) => {
            const types = (option.inputTypes || {})[input.id];
            if (Array.isArray(types) && types.length > 0) {
                input.allowedTypes = [...types];
            }
        });
        node.outputs.forEach((output) => {
            const types = (option.outputTypes || {})[output.id];
            if (Array.isArray(types) && types.length > 0) {
                output.allowedTypes = [...types];
                output.outputType = types[0];
            }
        });
    });
}

class MockNodeGraph {
    constructor(graph) {
        this.id = graph.id;
        this.name = graph.name;
        this.executionType = graph.executionType;
        this.nodes = new Map();
        this.connections = graph.connections.map((connection) => ({
            fromNode: String(connection.fromNode),
            fromIndex: connection.fromIndex,
            toNode: String(connection.toNode),
            toIndex: connection.toIndex,
        }));
    }

    getId() {
        return this.id;
    }

    getName() {
        return this.name;
    }

    getTriggerInterval() {
        return 500;
    }

    getExecutionType() {
        return this.executionType;
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
        this.nodes.set(String(id), node);
    }
}

class MockCollection {
    constructor() {
        this.graphs = new Map();
    }

    getId() {
        return 'mqtt-hass-demo';
    }

    getVersion() {
        return '1.0.0';
    }

    getGraphs() {
        const result = {};
        this.graphs.forEach((graph, id) => {
            result[id] = graph;
        });
        return result;
    }

    addGraph(graph) {
        this.graphs.set(graph.getId(), graph);
    }
}

class MockDeviceRuntime {
    constructor(nodeTypes) {
        this.nodeTypes = nodeTypes;
    }

    getNodeType(type) {
        return this.nodeTypes[type] || null;
    }
}

describe('mqtt + hass example collection transpile', () => {
    // Each load re-registers the generators on a fresh global registry, so the import
    // needs a fresh URL: an identical specifier would be served from the ES module cache
    // and the generator file body would not run again.
    let generatorLoadCount = 0;

    async function loadGenerators() {
        generatorLoadCount += 1;
        const cacheKey = `demo-transpile-${generatorLoadCount}`;
        const previousSelf = globalThis.self;
        const previousWindow = globalThis.window;
        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        globalThis.NodeInitGenerators = {};

        for (const packageId of ['core', 'mqtt', 'vars', 'hass']) {
            const generatorsPath = path.join(packagesRoot, packageId, 'node_generators.js');
            if (!existsSync(generatorsPath)) {
                continue;
            }
            const url = pathToFileURL(generatorsPath);
            await import(`${url.href}?test=${cacheKey}-${packageId}`);
        }

        return () => {
            if (previousSelf === undefined) delete globalThis.self;
            else globalThis.self = previousSelf;
            if (previousWindow === undefined) delete globalThis.window;
            else globalThis.window = previousWindow;
        };
    }

    /** Transpile the shipped demo collection and return the generated app code. */
    async function transpileDemo() {
        const restoreGlobals = await loadGenerators();
        try {
            const nodeTypes = loadNodeTypes();
            const runtime = new MockDeviceRuntime(nodeTypes);
            const collection = new MockCollection();

            loadExample().graphs.forEach((graph) => {
                const mockGraph = new MockNodeGraph(graph);
                graph.nodes.forEach((node) => {
                    const definition = nodeTypes[node.type];
                    assert.ok(
                        definition,
                        `graph '${graph.name}' uses unknown node type '${node.type}'`
                    );
                    mockGraph.addNode(node.id, new MockNodeData(definition, node.id, node));
                });
                collection.addGraph(mockGraph);
            });

            const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
            const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
            return result.code;
        } finally {
            restoreGlobals();
        }
    }

    it('transpiles the demo into init_mqtt and loop code', async () => {
        const code = await transpileDemo();

        // The single-channel select keeps its channel-1 code shape: node 3 feeds trueValue
        // and the condition default is true.
        assert.ok(
            code.includes("        node_4_out0 = (node_3_out0) if bool(True) else ('low')"),
            'the demo select must still emit the single conditional expression'
        );

        assert.equal(code.split('async def init_mqtt').length - 1, 1);
        assert.equal(code.split('_mqtt.start()').length - 1, 1);
        assert.ok(code.includes('_hass.configure('));
        assert.ok(code.includes("_hass.register_entity('sensor', 'temperature'"));
        assert.ok(
            code.includes(
                "_hass.register_entity('sensor', 'temperature', config={'icon': 'mdi:thermometer'"
            )
        );
        assert.ok(code.includes("'icon': 'mdi:tune'"));
        assert.ok(code.includes("availability_flags=['heating']"));
        assert.ok(
            code.includes("_mqtt.publish_deferred(topic=_hass.availability_topic('heating')")
        );
        assert.ok(code.includes("_hass.publish_state('sensor', 'temperature'"));
    });

    it('reduces the demo select to the single-channel definition', async () => {
        const nodeTypes = loadNodeTypes();
        const selectDefinition = nodeTypes['core.select'];
        const demoSelect = loadExample()
            .graphs.flatMap((graph) => graph.nodes)
            .find((node) => node.type === 'core.select');

        assert.deepEqual(selectDefinition.inputs.map((input) => input.id), [
            'condition',
            'trueValue',
            'falseValue',
        ]);
        assert.deepEqual(selectDefinition.outputs.map((output) => output.id), ['value']);

        // The saved node carries no connector snapshot, so definition reconciliation
        // is what gives it one output; its stored defaults must match that definition.
        assert.deepEqual(Object.keys(demoSelect.inputDefaults).sort(), [
            'condition',
            'falseValue',
            'trueValue',
        ]);

        const code = await transpileDemo();
        ['condition_2', 'trueValue_2', 'falseValue_2', 'value_2'].forEach((artifact) => {
            assert.equal(
                code.includes(artifact),
                false,
                `the demo select must not emit ${artifact}`
            );
        });
    });

    it('asserts the taxonomy shapes in the generated app', async () => {
        const code = await transpileDemo();

        // send + receive: the text entity is announced with a state topic.
        assert.equal(code.split("_hass.register_entity('text'").length - 1, 1);
        assert.ok(code.includes("_hass.publish_state('text', 'label'"));

        // receive only: the button is announced without a state topic and never published.
        assert.equal(code.split("_hass.register_entity('button'").length - 1, 1);
        assert.ok(code.includes('report_state=False'));
        assert.ok(code.includes("_hass.take_command('button', 'reset'"));
        assert.equal(code.includes("publish_state('button'"), false);

        // One-cycle edges are consumed under per-node keys, never under the topic default.
        assert.ok(code.includes("_hass.take_command('text', 'label'"));
        assert.ok(code.includes("key='hass_cmd_12'"));
        assert.ok(code.includes("key='hass_cmd_13'"));
        assert.ok(code.includes("key='hass_cmd_15'"));

        // Device authority: the target number publishes its input and has no sticky command.
        assert.ok(code.includes("_hass.publish_state('number', 'target', (node_1_out0)"));
        assert.equal(code.includes("_hass.latest_command('number', 'target'"), false);
    });

    it('generates an app that compiles as Python', async (t) => {
        // Regression guard: the Init graph holds only the HA bridge, whose loop
        // implementation is a comment. The transpiler used to emit
        // `async def init():` with a comment-only body, and the device reported
        // `controller-main-loop-load-failed` because nothing was ever announced.
        const code = await transpileDemo();
        const python = process.env.PYTHON || 'python3';

        try {
            execFileSync(python, ['-c', PYTHON_COMPILE_SCRIPT], {
                input: code,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch (error) {
            if (error?.code === 'ENOENT') {
                t.skip(`${python} is not installed; skipping the generated-app syntax check`);
                return;
            }
            assert.fail(
                `generated demo app does not compile: ${error?.stderr || error?.message}\n${code}`
            );
        }
    });
});
