// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Shared harness for the transpiler function-graph tests.
 *
 * Mock graphs expose the function-signature accessors the transpiler reads, the runtime
 * provides one `regex` node with an init statement (so the hoisted init and the shared
 * instance are observable), and the builders produce the ordinary call/emit shapes the
 * tests compare against.
 */

import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

/** Minimal node data shape consumed by the transpiler. */
export class MockNodeData {
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
}

/** Minimal graph shape with the function-signature accessors. */
export class MockNodeGraph {
    constructor({
        id,
        name,
        executionType = 'continuous',
        triggerInterval = 500,
        executionSignature = null,
        enabled = true,
    }) {
        this.id = id;
        this.name = name;
        this.executionType = executionType;
        this.triggerInterval = triggerInterval;
        this.functionSignature = executionSignature;
        this.enabled = enabled;
        this.nodes = new Map();
        this.connections = [];
    }

    getId() {
        return this.id;
    }

    getName() {
        return this.name;
    }

    getExecutionType() {
        return this.executionType;
    }

    getEnabled() {
        return this.enabled;
    }

    getTriggerInterval() {
        return this.triggerInterval;
    }

    getTriggerName() {
        return '';
    }

    getSignalNames() {
        return [];
    }

    getSignalMode() {
        return 'any';
    }

    getRunOnStart() {
        return true;
    }

    getFunctionSignature() {
        return this.functionSignature;
    }

    getNodes() {
        const result = {};
        this.nodes.forEach((node, id) => {
            result[id] = node;
        });
        return result;
    }

    addNode(id, node) {
        this.nodes.set(id, node);
    }

    getConnections() {
        return this.connections.slice();
    }
}

/** Minimal collection shape consumed by the transpiler. */
export class MockCollection {
    constructor(graphs = []) {
        this.graphs = new Map(graphs.map((graph) => [graph.getId(), graph]));
    }

    getId() {
        return 'function-collection';
    }

    getVersion() {
        return '1.0.0';
    }

    getVersionString() {
        return '1.0.0';
    }

    getTitle() {
        return 'Functions';
    }

    getGraphs() {
        const result = {};
        this.graphs.forEach((graph, id) => {
            result[id] = graph;
        });
        return result;
    }
}

/** Runtime stub that resolves the test node definitions. */
export class MockRuntime {
    constructor() {
        this.defs = new Map();
    }

    addNodeDefinition(type, def) {
        this.defs.set(type, def);
    }

    getNodeType(type) {
        return this.defs.get(type) || null;
    }
}

/**
 * Runtime with the three nodes the tests use.
 *
 * `sensor` reads its single input and is created once by an init statement; `stateful`
 * is the read-modify-write shape of a node that carries state across calls (`x = f(x)`,
 * with `x` initialized by the hoisted init); `emit` prints its control value. All three
 * are `regex` implementations, the simplest shape.
 * @returns {MockRuntime} Runtime stub.
 */
export function buildRuntime() {
    const runtime = new MockRuntime();
    runtime.addNodeDefinition('sensor', {
        inputs: [{ id: 'in0', name: 'Channel', allowedTypes: ['any'] }],
        outputs: [{ id: 'out0', name: 'Reading', outputType: 'float' }],
        implementations: { python: { type: 'regex', value: 'sensor.read({{in0}})' } },
        initImplementations: { python: { type: 'regex', value: 'sensor = make_sensor()' } },
    });
    runtime.addNodeDefinition('stateful', {
        inputs: [{ id: 'in0', name: 'Step', allowedTypes: ['any'] }],
        outputs: [{ id: 'out0', name: 'Value', outputType: 'float' }],
        implementations: { python: { type: 'regex', value: 'push({{out0}}, {{in0}})' } },
        initImplementations: { python: { type: 'regex', value: '{{out0}} = None' } },
    });
    runtime.addNodeDefinition('emit', {
        inputs: [],
        outputs: [],
        controls: [{ id: 'value', type: 'number' }],
        implementations: { python: { type: 'regex', value: 'print({{value}})' } },
    });
    return runtime;
}

/**
 * Build a signature with the given port names.
 * @param {string[]} inputNames - Input port names.
 * @param {string[]} outputNames - Output port names.
 * @returns {object} Function signature.
 */
export function createSignature(inputNames = [], outputNames = []) {
    return {
        category: 'math',
        inputs: inputNames.map((name) => ({ name, types: ['any'] })),
        outputs: outputNames.map((name) => ({ name, types: ['any'] })),
    };
}

/**
 * Structural input node mirrored from the signature.
 * @param {object} signature - Function signature.
 * @returns {MockNodeData} Node data.
 */
export function inputNode(signature) {
    return new MockNodeData({
        id: 'in',
        type: 'graph.function.input',
        outputs: signature.inputs.map((port, index) => ({
            id: `in_${index}`,
            name: port.name,
        })),
    });
}

/**
 * Structural output node mirrored from the signature.
 * @param {object} signature - Function signature.
 * @returns {MockNodeData} Node data.
 */
export function outputNode(signature) {
    return new MockNodeData({
        id: 'out',
        type: 'graph.function.output',
        inputs: signature.outputs.map((port, index) => ({
            id: `out_${index}`,
            name: port.name,
        })),
    });
}

/**
 * Build a function graph: one input node, one sensor node per required value and an
 * output node when the signature declares outputs.
 *
 * The sensor nodes are `regex` nodes with an init statement, so the body, the hoisted
 * init and the `return` all have observable code.
 *
 * @param {object} options - Graph options.
 * @returns {MockNodeGraph} Function graph.
 */
export function createFunctionGraph({
    id = 'fn-1',
    name = 'Sensor Read',
    inputNames = ['channel'],
    outputNames = ['value'],
    sensorCount = null,
} = {}) {
    const signature = createSignature(inputNames, outputNames);
    const graph = new MockNodeGraph({
        id,
        name,
        executionType: 'function',
        executionSignature: signature,
    });

    if (inputNames.length > 0) {
        graph.addNode('in', inputNode(signature));
    }

    const sensors = sensorCount ?? Math.max(outputNames.length, 1);
    for (let index = 0; index < sensors; index += 1) {
        const nodeId = `sensor${index}`;
        graph.addNode(
            nodeId,
            new MockNodeData({
                id: nodeId,
                type: 'sensor',
                inputs: [{ id: 'in0', name: 'Channel' }],
                outputs: [{ id: 'out0', name: 'Reading' }],
            })
        );
        if (inputNames.length > 0) {
            graph.connections.push({
                fromNode: 'in',
                fromIndex: index % inputNames.length,
                toNode: nodeId,
                toIndex: 0,
            });
        }
    }

    if (outputNames.length > 0) {
        graph.addNode('out', outputNode(signature));
        outputNames.forEach((_name, index) => {
            graph.connections.push({
                fromNode: `sensor${index % sensors}`,
                fromIndex: 0,
                toNode: 'out',
                toIndex: index,
            });
        });
    }

    return graph;
}

/**
 * Build a function graph with one read-modify-write node.
 *
 * The node reads and writes its own output variable — the shape of a node that keeps a
 * buffer across calls — so the emitted body has to declare the hoisted init's global
 * before that first read.
 *
 * @param {object} options - Graph options.
 * @returns {MockNodeGraph} Function graph.
 */
export function createStatefulFunctionGraph({ id = 'fn-buffer', name = 'Buffer' } = {}) {
    const signature = createSignature(['step'], ['value']);
    const graph = new MockNodeGraph({
        id,
        name,
        executionType: 'function',
        executionSignature: signature,
    });

    graph.addNode('in', inputNode(signature));
    graph.addNode(
        'stateful0',
        new MockNodeData({
            id: 'stateful0',
            type: 'stateful',
            inputs: [{ id: 'in0', name: 'Step' }],
            outputs: [{ id: 'out0', name: 'Value' }],
        })
    );
    graph.connections.push({ fromNode: 'in', fromIndex: 0, toNode: 'stateful0', toIndex: 0 });

    graph.addNode('out', outputNode(signature));
    graph.connections.push({ fromNode: 'stateful0', fromIndex: 0, toNode: 'out', toIndex: 0 });

    return graph;
}

/**
 * Build a continuous graph that calls one function graph.
 * @param {object} options - Graph and call options.
 * @returns {MockNodeGraph} Calling graph.
 */
export function createCallingGraph({
    id = 'graph-1',
    name = 'Read Sensors',
    calleeGraphId = 'fn-1',
    arguments: callArguments = [3],
    typeId = null,
} = {}) {
    const graph = new MockNodeGraph({ id, name, executionType: 'continuous', triggerInterval: 500 });
    const inputIds = callArguments.map((_value, index) => `in_${index}`);
    graph.addNode(
        'call',
        new MockNodeData({
            id: 'call',
            type: typeId ?? `function_graph.${calleeGraphId}`,
            inputs: inputIds.map((inputId) => ({ id: inputId, name: inputId })),
            outputs: [{ id: 'out_0', name: 'result' }],
            inputDefaults: Object.fromEntries(
                inputIds.map((inputId, index) => [inputId, callArguments[index]])
            ),
        })
    );
    return graph;
}

/**
 * Build a continuous graph with one `emit` node and no function call.
 * @param {object} options - Graph options.
 * @returns {MockNodeGraph} Graph.
 */
export function createEmitGraph({ id = 'graph-1', name = 'Main', value = 1 } = {}) {
    const graph = new MockNodeGraph({
        id,
        name,
        executionType: 'continuous',
        triggerInterval: 500,
    });
    graph.addNode(
        'emit',
        new MockNodeData({
            id: 'emit',
            type: 'emit',
            controls: [{ id: 'value', type: 'number' }],
            controlValues: { value },
        })
    );
    return graph;
}

/**
 * Add a call node for another function graph to a graph.
 *
 * The connector count is what the port-count validation compares against the callee's
 * signature, so the tests can build mismatching nodes on purpose.
 *
 * @param {MockNodeGraph} graph - Graph that receives the node.
 * @param {object} options - Node options.
 * @returns {MockNodeData} The added node data.
 */
export function addCallNode(
    graph,
    { id = 'call', calleeGraphId, inputCount = 1, typeId = null, inputDefaults = {} } = {}
) {
    const node = new MockNodeData({
        id,
        type: typeId ?? `function_graph.${calleeGraphId}`,
        inputs: Array.from({ length: inputCount }, (_unused, index) => ({
            id: `in_${index}`,
            name: `in_${index}`,
        })),
        outputs: [{ id: 'out_0', name: 'result' }],
        inputDefaults,
    });
    graph.addNode(id, node);
    return node;
}

/**
 * Transpile the given graphs in order.
 * @param {MockNodeGraph[]} graphs - Graphs of the collection.
 * @returns {Promise<string>} Generated Python code.
 */
export async function transpile(graphs) {
    const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
    const result = await transpiler.transpile(new MockCollection(graphs), {
        deviceRuntime: buildRuntime(),
    });
    return result.code;
}
