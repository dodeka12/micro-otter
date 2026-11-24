// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Integration tests for Transpiler class.
 *
 * Tests the complete transpilation pipeline from node graphs to Python code.
 * Validates all implementation types (regex, function, code-generator) and
 * full workflow including progress events, caching, and error handling.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';
import {
    ProgressEventBus,
    ProgressEventType,
} from '../../src/micro_otter/nodes/html/js/core/progress-events.js';

/**
 * Mock Workspace for testing.
 */
class MockWorkspace {
    constructor() {
        this.collections = new Map();
        this.deviceRuntime = new MockDeviceRuntime();
    }

    getCollection(id) {
        return this.collections.get(id);
    }

    addCollection(id, collection) {
        this.collections.set(id, collection);
    }

    getDeviceRuntime() {
        return this.deviceRuntime;
    }
}

/**
 * Mock Collection.
 */
class MockCollection {
    constructor(id, version = '1.0.0') {
        this.id = id;
        this.version = version;
        this.graphs = new Map();
        this.deviceRuntimeId = 'general';
    }

    getId() {
        return this.id;
    }

    getVersion() {
        return this.version;
    }

    setVersion(version) {
        this.version = version;
    }

    getGraphs() {
        const result = {};
        this.graphs.forEach((graph, id) => {
            result[id] = graph;
        });
        return result;
    }

    getGraph(id) {
        return this.graphs.get(id);
    }

    addGraph(id, graph) {
        this.graphs.set(id, graph);
    }

    getDeviceRuntimeId() {
        return this.deviceRuntimeId;
    }
}

/**
 * Mock NodeGraph.
 */
class MockNodeGraph {
    constructor(id, name, intervalMs = 500) {
        this.id = id;
        this.name = name;
        this.intervalMs = intervalMs;
        this.nodes = new Map();
        this.connections = [];
    }

    getId() {
        return this.id;
    }

    getName() {
        return this.name;
    }

    getTriggerInterval() {
        return this.intervalMs;
    }

    getNodes() {
        const result = {};
        this.nodes.forEach((node, id) => {
            result[id] = node;
        });
        return result;
    }

    getNode(id) {
        return this.nodes.get(id);
    }

    addNode(id, node) {
        this.nodes.set(id, node);
    }

    getConnections() {
        return this.connections.slice();
    }

    addConnection(conn) {
        this.connections.push(conn);
    }
}

/**
 * Mock NodeData.
 */
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

/**
 * Mock DeviceRuntime.
 */
class MockDeviceRuntime {
    constructor() {
        this.nodeDefinitions = new Map();
    }

    getNodeDefinition(type) {
        return this.nodeDefinitions.get(type);
    }

    addNodeDefinition(type, definition) {
        this.nodeDefinitions.set(type, { ...definition, packageId: 'core' });
    }
}

/**
 * Create test workspace with sample nodes.
 */
function createTestWorkspace() {
    const workspace = new MockWorkspace();

    // Add node definitions
    workspace.deviceRuntime.addNodeDefinition('const', {
        title: 'Constant',
        inputs: [],
        outputs: [{ id: 'out0', name: 'Value' }],
        controls: [{ id: 'value', type: 'number', default: 0 }],
        implementations: {
            python: {
                type: 'regex',
                value: '{{value}}',
            },
        },
    });

    workspace.deviceRuntime.addNodeDefinition('print', {
        title: 'Print',
        inputs: [{ id: 'in0', name: 'Value' }],
        outputs: [],
        controls: [{ id: 'label', type: 'text', default: '' }],
        implementations: {
            python: {
                type: 'regex',
                value: 'print({{label}}, {{in0}})',
            },
        },
    });

    workspace.deviceRuntime.addNodeDefinition('scale', {
        title: 'Scale',
        inputs: [{ id: 'in0', name: 'Value' }],
        outputs: [{ id: 'out0', name: 'Result' }],
        controls: [{ id: 'factor', type: 'number', default: 1 }],
        implementations: {
            python: {
                type: 'function',
                value: 'ScaleNodeFunction',
            },
        },
        initImplementations: {
            python: {
                type: 'regex',
                value: 'class ScaleNodeFunction:\n    def __init__(self, inputs_meta, outputs_meta, controls):\n        self.factor = controls.get("factor", 1)\n    def __call__(self, value):\n        return value * self.factor',
            },
        },
    });

    workspace.deviceRuntime.addNodeDefinition('custom', {
        title: 'Custom',
        inputs: [{ id: 'in0', name: 'Value' }],
        outputs: [{ id: 'out0', name: 'Result' }],
        controls: [],
        implementations: {
            python: {
                type: 'code-generator',
                value: 'CustomNodeGenerator',
            },
        },
        mpAssets: ['libs/custom_module.py'],
        mpModuleRoots: ['libs/'],
    });

    workspace.deviceRuntime.addNodeDefinition('stateful', {
        title: 'Stateful',
        inputs: [],
        outputs: [{ id: 'out0', name: 'Value' }],
        controls: [],
        implementations: {
            python: {
                type: 'code-generator',
                value: 'StatefulNodeGenerator',
            },
        },
        initImplementations: {
            python: {
                type: 'code-generator',
                value: 'StatefulNodeInitGenerator',
            },
        },
    });

    // Register global code generator
    global.CustomNodeGenerator = function (context) {
        const { outputs } = context;
        return {
            statement: `${outputs[0]} = 42  # Generated by custom generator`,
            imports: ['from custom_module import helper'],
        };
    };

    global.StatefulNodeInitGenerator = function (_context) {
        return {
            statement: 'STATE_NODE_A = 0',
        };
    };

    global.StatefulNodeGenerator = function (context) {
        const { outputs } = context;
        return {
            statement: `STATE_NODE_A = STATE_NODE_A + 1\n${outputs[0]} = STATE_NODE_A`,
            outputs,
        };
    };

    return workspace;
}

describe('Transpiler Integration Tests', () => {
    let workspace;
    let transpiler;
    let progressEvents;
    let progressListener;

    beforeEach(() => {
        workspace = createTestWorkspace();
        transpiler = new Transpiler({ logger: { log: () => {} } });
        progressEvents = [];

        // Subscribe to progress events
        progressListener = (event) => {
            progressEvents.push({
                type: event.type,
                source: event.source,
                message: event.message,
                progress: event.progress,
            });
        };
        ProgressEventBus.subscribe(progressListener);
    });

    afterEach(() => {
        // Clean up progress listener
        if (progressListener) {
            ProgressEventBus.unsubscribe(progressListener);
        }
    });

    describe('Basic Transpilation', () => {
        it('should transpile a simple const → print graph', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'TestGraph');

            // Add const node
            const constNode = new MockNodeData({
                id: 'node1',
                type: 'const',
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [{ id: 'value', type: 'number' }],
                controlValues: { value: 42 },
            });
            graph.addNode('node1', constNode);

            // Add print node
            const printNode = new MockNodeData({
                id: 'node2',
                type: 'print',
                inputs: [{ id: 'in0', name: 'Value' }],
                controls: [{ id: 'label', type: 'text' }],
                controlValues: { label: 'Result:' },
            });
            graph.addNode('node2', printNode);

            // Connect const → print
            graph.addConnection({
                fromNode: 'node1',
                fromIndex: 0,
                toNode: 'node2',
                toIndex: 0,
            });

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(result.code, 'Should return generated code');
            assert.ok(result.code.includes('async def'), 'Should generate async function');
            assert.ok(result.code.includes('asyncio'), 'Should include asyncio import');
            assert.ok(
                result.code.includes('import uasyncio as asyncio'),
                'Should include explicit MicroPython asyncio import'
            );
            assert.ok(result.code.includes('node_node1_out0 = 42'), 'Should generate const node');
            assert.ok(
                result.code.includes('print(') && result.code.includes('node_node1_out0'),
                'Should generate print node with connection'
            );
        });

        it('emits explicit cast when connection requires implicit conversion', async () => {
            workspace.deviceRuntime.addNodeDefinition('boolSource', {
                title: 'Bool Source',
                inputs: [],
                outputs: [{ id: 'out0', name: 'Value', outputType: 'bool' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'regex',
                        value: 'True',
                    },
                },
            });

            workspace.deviceRuntime.addNodeDefinition('floatConsumer', {
                title: 'Float Consumer',
                inputs: [{ id: 'in0', name: 'Value', allowedTypes: ['float'] }],
                outputs: [{ id: 'out0', name: 'Out', outputType: 'float' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'regex',
                        value: '{{in0}}',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'ConversionGraph');

            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'boolSource',
                    outputs: [{ id: 'out0', name: 'Value', outputType: 'bool' }],
                })
            );

            graph.addNode(
                'node2',
                new MockNodeData({
                    id: 'node2',
                    type: 'floatConsumer',
                    inputs: [{ id: 'in0', name: 'Value', allowedTypes: ['float'] }],
                    outputs: [{ id: 'out0', name: 'Out', outputType: 'float' }],
                })
            );

            graph.addConnection({
                fromNode: 'node1',
                fromIndex: 0,
                toNode: 'node2',
                toIndex: 0,
            });

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes('node_node2_out0 = float(node_node1_out0)'),
                'Should emit explicit float(...) cast for bool -> float input conversion'
            );
        });

        it('should transpile graph with function-based node', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'ScaleGraph');

            const constNode = new MockNodeData({
                id: 'node1',
                type: 'const',
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [{ id: 'value', type: 'number' }],
                controlValues: { value: 10 },
            });
            graph.addNode('node1', constNode);

            const scaleNode = new MockNodeData({
                id: 'node2',
                type: 'scale',
                inputs: [{ id: 'in0', name: 'Value' }],
                outputs: [{ id: 'out0', name: 'Result' }],
                controls: [{ id: 'factor', type: 'number' }],
                controlValues: { factor: 3 },
            });
            graph.addNode('node2', scaleNode);

            graph.addConnection({
                fromNode: 'node1',
                fromIndex: 0,
                toNode: 'node2',
                toIndex: 0,
            });

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            // Note: initImplementations not yet supported, so no class definition
            assert.ok(
                result.code.includes('node_node2_impl = ScaleNodeFunction'),
                'Should instantiate function class'
            );
            assert.ok(
                result.code.includes('node_node2_impl(node_node1_out0)'),
                'Should call function instance with correct variable'
            );
        });

        it('should emit callable function prelude metadata and tuple assignment semantics', async () => {
            workspace.deviceRuntime.addNodeDefinition('callableFn', {
                title: 'Callable Function Node',
                inputs: [
                    { id: 'in0', name: 'A' },
                    { id: 'in1', name: 'B' },
                ],
                outputs: [
                    { id: 'out0', name: 'X' },
                    { id: 'out1', name: 'Y' },
                ],
                controls: [],
                implementations: {
                    python: {
                        type: 'function',
                        value: 'pkg.MyCallable',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'CallableGraph');

            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'const',
                    outputs: [{ id: 'out0', name: 'Value' }],
                    controls: [{ id: 'value', type: 'number' }],
                    controlValues: { value: 10 },
                })
            );

            graph.addNode(
                'node2',
                new MockNodeData({
                    id: 'node2',
                    type: 'callableFn',
                    inputs: [
                        { id: 'in0', name: 'A' },
                        { id: 'in1', name: 'B' },
                    ],
                    outputs: [
                        { id: 'out0', name: 'X' },
                        { id: 'out1', name: 'Y' },
                    ],
                    controls: [],
                })
            );

            graph.addNode(
                'node3',
                new MockNodeData({
                    id: 'node3',
                    type: 'print',
                    inputs: [{ id: 'in0', name: 'Value' }],
                    controls: [{ id: 'label', type: 'text' }],
                    controlValues: { label: 'Callable:' },
                })
            );

            graph.addConnection({ fromNode: 'node1', fromIndex: 0, toNode: 'node2', toIndex: 0 });
            graph.addConnection({ fromNode: 'node2', fromIndex: 0, toNode: 'node3', toIndex: 0 });

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes('from pkg import MyCallable'),
                'Should register dotted callable import'
            );

            const normalizedCode = result.code.replace(/\s+/g, '');
            const prelude =
                "node_node2_impl=MyCallable(inputs_meta=[{'id':'in0','name':'A','connected':True},{'id':'in1','name':'B','connected':False}],outputs_meta=[{'id':'out0','name':'X','connected':True,'var_name':'node_node2_out0'},{'id':'out1','name':'Y','connected':False,'var_name':'node_node2_out1'}],controls={})";
            const tupleCall =
                'node_node2_out0,node_node2_out1=node_node2_impl(node_node1_out0,None)';

            assert.ok(
                normalizedCode.includes(prelude),
                'Should instantiate callable with connector metadata and output var names'
            );
            assert.ok(
                normalizedCode.includes(tupleCall),
                'Should emit tuple assignment and None padding for disconnected input'
            );

            const preludeIndex = normalizedCode.indexOf(prelude);
            const callIndex = normalizedCode.indexOf(tupleCall);
            assert.ok(
                preludeIndex !== -1 && callIndex !== -1 && preludeIndex < callIndex,
                'Callable prelude should appear before callable invocation'
            );
        });

        it('should emit disconnected function connector metadata in pre-loop prelude', async () => {
            workspace.deviceRuntime.addNodeDefinition('functionPreludeNode', {
                title: 'Function Prelude Node',
                inputs: [
                    { id: 'in0', name: 'Input A' },
                    { id: 'in1', name: 'Input B' },
                ],
                outputs: [{ id: 'out0', name: 'Out' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'function',
                        value: 'my_module.MyClass',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'FunctionPreludeGraph');

            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'functionPreludeNode',
                    inputs: [
                        { id: 'in0', name: 'Input A' },
                        { id: 'in1', name: 'Input B' },
                    ],
                    outputs: [{ id: 'out0', name: 'Out' }],
                    controls: [],
                })
            );

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes('from my_module import MyClass'),
                'Should register dotted function import for class prelude'
            );

            const normalizedCode = result.code.replace(/\s+/g, '');
            const prelude =
                "node_node1_impl=MyClass(inputs_meta=[{'id':'in0','name':'InputA','connected':False},{'id':'in1','name':'InputB','connected':False}],outputs_meta=[{'id':'out0','name':'Out','connected':False,'var_name':'node_node1_out0'}],controls={})";

            assert.ok(
                normalizedCode.includes(prelude),
                'Should emit disconnected connector metadata in function prelude'
            );

            const preludeIndex = normalizedCode.indexOf(prelude);
            const loopIndex = normalizedCode.indexOf('whileTrue:');
            assert.ok(
                preludeIndex !== -1 && loopIndex !== -1 && preludeIndex < loopIndex,
                'Function prelude should be emitted before loop body'
            );
        });

        it('should transpile servo function node with callable prelude metadata and direct assignment', async () => {
            workspace.deviceRuntime.addNodeDefinition('servo', {
                title: 'Servo',
                inputs: [
                    {
                        id: 'enabled',
                        name: 'Enabled',
                        allowedTypes: ['bool'],
                        initialTypes: ['bool'],
                        defaultControl: {
                            type: 'checkbox',
                            label: 'Enabled',
                            default: true,
                        },
                    },
                    { id: 'angle', name: 'Angle' },
                ],
                outputs: [{ id: 'angleOut', name: 'Angle Out' }],
                controls: [
                    { id: 'pin', type: 'number' },
                    { id: 'minUs', type: 'number' },
                    { id: 'maxUs', type: 'number' },
                    { id: 'rangeMin', type: 'number' },
                    { id: 'rangeMax', type: 'number' },
                    { id: 'maxRate', type: 'number' },
                ],
                implementations: {
                    python: {
                        type: 'function',
                        value: 'packages.stdmo.servo_callable.ServoNodeFn',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'ServoGraph');

            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'servo',
                    inputs: [
                        {
                            id: 'enabled',
                            name: 'Enabled',
                            allowedTypes: ['bool'],
                            initialTypes: ['bool'],
                            defaultControl: {
                                type: 'checkbox',
                                label: 'Enabled',
                                default: true,
                            },
                        },
                        { id: 'angle', name: 'Angle' },
                    ],
                    outputs: [{ id: 'angleOut', name: 'Angle Out' }],
                    controls: [
                        { id: 'pin', type: 'number' },
                        { id: 'minUs', type: 'number' },
                        { id: 'maxUs', type: 'number' },
                        { id: 'rangeMin', type: 'number' },
                        { id: 'rangeMax', type: 'number' },
                        { id: 'maxRate', type: 'number' },
                    ],
                    controlValues: {
                        pin: 12,
                        minUs: 800,
                        maxUs: 2400,
                        rangeMin: -45,
                        rangeMax: 45,
                        maxRate: 90,
                    },
                })
            );

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes('from packages.stdmo.servo_callable import ServoNodeFn'),
                'Should register dotted servo callable import'
            );

            const normalizedCode = result.code.replace(/\s+/g, '');
            const prelude =
                "node_node1_impl=ServoNodeFn(inputs_meta=[{'id':'enabled','name':'Enabled','connected':False},{'id':'angle','name':'Angle','connected':False}],outputs_meta=[{'id':'angleOut','name':'AngleOut','connected':False,'var_name':'node_node1_out0'}],controls={'pin':12,'minUs':800,'maxUs':2400,'rangeMin':-45,'rangeMax':45,'maxRate':90})";
            const callLine = 'node_node1_out0=node_node1_impl(True,None)';

            assert.ok(
                normalizedCode.includes(prelude),
                'Should instantiate servo callable with connector metadata and controls'
            );
            assert.ok(
                normalizedCode.includes(callLine),
                'Should call servo callable with disconnected input padding and direct assignment'
            );

            const preludeIndex = normalizedCode.indexOf(prelude);
            const callIndex = normalizedCode.indexOf(callLine);
            assert.ok(
                preludeIndex !== -1 && callIndex !== -1 && preludeIndex < callIndex,
                'Servo callable prelude should appear before invocation'
            );
        });

        it('should assign function outputs directly without emitting output padding helper', async () => {
            workspace.deviceRuntime.addNodeDefinition('callablePad', {
                title: 'Callable Padding Node',
                inputs: [{ id: 'in0', name: 'A' }],
                outputs: [
                    { id: 'out0', name: 'X' },
                    { id: 'out1', name: 'Y' },
                    { id: 'out2', name: 'Z' },
                ],
                controls: [],
                implementations: {
                    python: {
                        type: 'function',
                        value: 'pkg.CallablePad',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'FunctionPaddingGraph');

            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'const',
                    outputs: [{ id: 'out0', name: 'Value' }],
                    controls: [{ id: 'value', type: 'number' }],
                    controlValues: { value: 7 },
                })
            );

            graph.addNode(
                'node2',
                new MockNodeData({
                    id: 'node2',
                    type: 'callablePad',
                    inputs: [{ id: 'in0', name: 'A' }],
                    outputs: [
                        { id: 'out0', name: 'X' },
                        { id: 'out1', name: 'Y' },
                        { id: 'out2', name: 'Z' },
                    ],
                    controls: [],
                })
            );

            graph.addConnection({ fromNode: 'node1', fromIndex: 0, toNode: 'node2', toIndex: 0 });

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            const normalizedCode = result.code.replace(/\s+/g, '');

            assert.ok(
                normalizedCode.includes('node_node2_impl=CallablePad'),
                'Should instantiate callable function implementation'
            );
            assert.ok(
                normalizedCode.includes(
                    'node_node2_out0,node_node2_out1,node_node2_out2=node_node2_impl(node_node1_out0)'
                ),
                'Should assign multi-output function call directly'
            );
            assert.ok(
                !normalizedCode.includes('def_mo_pad_outputs'),
                'Should not emit output padding helper function'
            );
        });

        it('should transpile graph with code generator node', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'CustomGraph');

            const customNode = new MockNodeData({
                id: 'node1',
                type: 'custom',
                inputs: [{ id: 'in0', name: 'Value' }],
                outputs: [{ id: 'out0', name: 'Result' }],
            });
            graph.addNode('node1', customNode);

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes('node_node1_out0 = 42'),
                'Should include generated statement'
            );
            assert.ok(
                result.code.includes('from custom_module import helper'),
                'Should include generator imports'
            );
        });

        it('should assign regex/function outputs and avoid extra wrapping for generator statements', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'AssignmentGraph');

            const constNode = new MockNodeData({
                id: 'node1',
                type: 'const',
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [{ id: 'value', type: 'number' }],
                controlValues: { value: 10 },
            });

            const scaleNode = new MockNodeData({
                id: 'node2',
                type: 'scale',
                inputs: [{ id: 'in0', name: 'Value' }],
                outputs: [{ id: 'out0', name: 'Result' }],
                controls: [{ id: 'factor', type: 'number' }],
                controlValues: { factor: 3 },
            });

            const customNode = new MockNodeData({
                id: 'node3',
                type: 'custom',
                inputs: [{ id: 'in0', name: 'Value' }],
                outputs: [{ id: 'out0', name: 'Result' }],
            });

            graph.addNode('node1', constNode);
            graph.addNode('node2', scaleNode);
            graph.addNode('node3', customNode);

            graph.addConnection({ fromNode: 'node1', fromIndex: 0, toNode: 'node2', toIndex: 0 });

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes('node_node1_out0 = 10'),
                'Regex implementation should assign output'
            );
            assert.ok(
                result.code.includes('node_node2_out0 = node_node2_impl(node_node1_out0)'),
                'Function implementation output should be assigned by transpiler'
            );
            assert.ok(
                result.code.includes('node_node3_out0 = 42'),
                'Generator statement should be emitted'
            );

            const generatorAssignCount = (result.code.match(/node_node3_out0\s*=/g) || []).length;
            assert.equal(
                generatorAssignCount,
                1,
                'Generator output must not be wrapped in an extra assignment'
            );
        });

        it('should provide deterministic output variable names to code generators', async () => {
            let receivedOutputs = null;
            global.DualOutGenerator = (context) => {
                receivedOutputs = context.outputs.slice();
                return {
                    statement: `${context.outputs[0]} = 10\n${context.outputs[1]} = 20`,
                };
            };

            workspace.deviceRuntime.addNodeDefinition('dualOut', {
                title: 'Dual Output Generator',
                inputs: [],
                outputs: [
                    { id: 'out0', name: 'First' },
                    { id: 'out1', name: 'Second' },
                ],
                controls: [],
                implementations: {
                    python: {
                        type: 'code-generator',
                        value: 'DualOutGenerator',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'DualOutputGraph');
            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'dualOut',
                    outputs: [
                        { id: 'out0', name: 'First' },
                        { id: 'out1', name: 'Second' },
                    ],
                })
            );

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.deepEqual(
                receivedOutputs,
                ['node_node1_out0', 'node_node1_out1'],
                'Generator should receive deterministic output variable names'
            );
            assert.ok(
                result.code.includes('node_node1_out0 = 10') &&
                    result.code.includes('node_node1_out1 = 20'),
                'Generated statement should assign both deterministic output variables'
            );

            delete global.DualOutGenerator;
        });

        it('should provide connector metadata to code generators', async () => {
            let receivedInputsMeta = null;
            let receivedOutputsMeta = null;
            global.GeneratorMetadataProbe = (context) => {
                receivedInputsMeta = context.inputsMeta;
                receivedOutputsMeta = context.outputsMeta;
                return {
                    statement: '# metadata probe',
                };
            };

            workspace.deviceRuntime.addNodeDefinition('generatorMeta', {
                title: 'Generator Metadata',
                inputs: [{ id: 'in0', name: 'Source' }],
                outputs: [{ id: 'out0', name: 'Result' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'code-generator',
                        value: 'GeneratorMetadataProbe',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'GeneratorMetadataGraph');

            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'const',
                    outputs: [{ id: 'out0', name: 'Value' }],
                    controls: [{ id: 'value', type: 'number' }],
                    controlValues: { value: 5 },
                })
            );
            graph.addNode(
                'node2',
                new MockNodeData({
                    id: 'node2',
                    type: 'generatorMeta',
                    inputs: [{ id: 'in0', name: 'Source' }],
                    outputs: [{ id: 'out0', name: 'Result' }],
                })
            );
            graph.addNode(
                'node3',
                new MockNodeData({
                    id: 'node3',
                    type: 'print',
                    inputs: [{ id: 'in0', name: 'Value' }],
                    controls: [{ id: 'label', type: 'text' }],
                    controlValues: { label: 'sink' },
                })
            );

            graph.addConnection({ fromNode: 'node1', fromIndex: 0, toNode: 'node2', toIndex: 0 });
            graph.addConnection({ fromNode: 'node2', fromIndex: 0, toNode: 'node3', toIndex: 0 });

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.deepEqual(receivedInputsMeta, [{ id: 'in0', name: 'Source', connected: true }]);
            assert.deepEqual(receivedOutputsMeta, [
                { id: 'out0', name: 'Result', varName: 'node_node2_out0', connected: true },
            ]);

            delete global.GeneratorMetadataProbe;
        });

        it('should suppress comment-only generator statements from emitted code', async () => {
            const marker = '# COMMENT_ONLY_GENERATOR_MARKER';
            global.CommentOnlyGeneratorProbe = () => ({
                statement: `${marker}\n# another comment line`,
            });

            workspace.deviceRuntime.addNodeDefinition('commentOnlyGeneratorProbe', {
                title: 'Comment Only Generator Probe',
                inputs: [],
                outputs: [],
                controls: [],
                implementations: {
                    python: {
                        type: 'code-generator',
                        value: 'CommentOnlyGeneratorProbe',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'CommentOnlyGeneratorGraph');

            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'commentOnlyGeneratorProbe',
                    outputs: [],
                })
            );

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                !result.code.includes(marker),
                'Comment-only generator lines should be suppressed from transpiler output'
            );
            assert.ok(
                !result.code.includes('# (No code emitted)'),
                'Transpiler should not inject fallback comment placeholders for empty generator output'
            );

            delete global.CommentOnlyGeneratorProbe;
        });

        it('should provide connected flags for unconnected outputs and allow selective emission', async () => {
            let receivedOutputsMeta = null;
            global.UnconnectedOutputsGenerator = (context) => {
                receivedOutputsMeta = context.outputsMeta?.map((entry) => ({ ...entry })) ?? null;
                const lines = [];
                if (context.outputsMeta?.[0]?.connected) {
                    lines.push(`${context.outputs[0]} = 1`);
                }
                if (context.outputsMeta?.[1]?.connected) {
                    lines.push(`${context.outputs[1]} = 2`);
                }
                return {
                    statement: lines.join('\n'),
                };
            };

            workspace.deviceRuntime.addNodeDefinition('unconnectedOutputsProbe', {
                title: 'Unconnected Outputs Probe',
                inputs: [],
                outputs: [
                    { id: 'out0', name: 'First' },
                    { id: 'out1', name: 'Second' },
                ],
                controls: [],
                implementations: {
                    python: {
                        type: 'code-generator',
                        value: 'UnconnectedOutputsGenerator',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'UnconnectedOutputsGraph');

            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'unconnectedOutputsProbe',
                    outputs: [
                        { id: 'out0', name: 'First' },
                        { id: 'out1', name: 'Second' },
                    ],
                })
            );
            graph.addNode(
                'node2',
                new MockNodeData({
                    id: 'node2',
                    type: 'print',
                    inputs: [{ id: 'in0', name: 'Value' }],
                    controls: [{ id: 'label', type: 'text' }],
                    controlValues: { label: 'sink' },
                })
            );
            graph.addConnection({ fromNode: 'node1', fromIndex: 0, toNode: 'node2', toIndex: 0 });

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.deepEqual(receivedOutputsMeta, [
                { id: 'out0', name: 'First', varName: 'node_node1_out0', connected: true },
                { id: 'out1', name: 'Second', varName: 'node_node1_out1', connected: false },
            ]);
            assert.ok(result.code.includes('node_node1_out0 = 1'));
            assert.ok(!result.code.includes('node_node1_out1 = 2'));

            delete global.UnconnectedOutputsGenerator;
        });

        it('should guard code-generator output emission by output connection metadata', async () => {
            const outputConnectedFlags = [];
            global.OutputConnectionGuardGenerator = (context) => {
                outputConnectedFlags.push(Boolean(context.outputsMeta?.[0]?.connected));
                if (!context.outputsMeta?.[0]?.connected) {
                    return {
                        statement: '# output disconnected',
                    };
                }
                return {
                    statement: `${context.outputs[0]} = OUT_CONN_GUARD_ASSIGN(${context.inputs[0]})`,
                };
            };

            workspace.deviceRuntime.addNodeDefinition('outputGuardedGenerator', {
                title: 'Output Guarded Generator',
                inputs: [{ id: 'in0', name: 'Source' }],
                outputs: [{ id: 'out0', name: 'Result' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'code-generator',
                        value: 'OutputConnectionGuardGenerator',
                    },
                },
            });

            const disconnectedCollection = new MockCollection('test-col-disconnected', '1.0.0');
            const disconnectedGraph = new MockNodeGraph('graph1', 'GuardDisconnectedGraph');

            disconnectedGraph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'const',
                    outputs: [{ id: 'out0', name: 'Value' }],
                    controls: [{ id: 'value', type: 'number' }],
                    controlValues: { value: 5 },
                })
            );
            disconnectedGraph.addNode(
                'node2',
                new MockNodeData({
                    id: 'node2',
                    type: 'outputGuardedGenerator',
                    inputs: [{ id: 'in0', name: 'Source' }],
                    outputs: [{ id: 'out0', name: 'Result' }],
                })
            );
            disconnectedGraph.addConnection({
                fromNode: 'node1',
                fromIndex: 0,
                toNode: 'node2',
                toIndex: 0,
            });

            disconnectedCollection.addGraph('graph1', disconnectedGraph);
            workspace.addCollection('test-col-disconnected', disconnectedCollection);

            const disconnectedResult = await transpiler.transpile(disconnectedCollection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                !disconnectedResult.code.includes('OUT_CONN_GUARD_ASSIGN'),
                'Should skip guarded assignment when output is disconnected'
            );

            const connectedCollection = new MockCollection('test-col-connected', '1.0.0');
            const connectedGraph = new MockNodeGraph('graph2', 'GuardConnectedGraph');

            connectedGraph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'const',
                    outputs: [{ id: 'out0', name: 'Value' }],
                    controls: [{ id: 'value', type: 'number' }],
                    controlValues: { value: 9 },
                })
            );
            connectedGraph.addNode(
                'node2',
                new MockNodeData({
                    id: 'node2',
                    type: 'outputGuardedGenerator',
                    inputs: [{ id: 'in0', name: 'Source' }],
                    outputs: [{ id: 'out0', name: 'Result' }],
                })
            );
            connectedGraph.addNode(
                'node3',
                new MockNodeData({
                    id: 'node3',
                    type: 'print',
                    inputs: [{ id: 'in0', name: 'Value' }],
                    controls: [{ id: 'label', type: 'text' }],
                    controlValues: { label: 'sink' },
                })
            );
            connectedGraph.addConnection({
                fromNode: 'node1',
                fromIndex: 0,
                toNode: 'node2',
                toIndex: 0,
            });
            connectedGraph.addConnection({
                fromNode: 'node2',
                fromIndex: 0,
                toNode: 'node3',
                toIndex: 0,
            });

            connectedCollection.addGraph('graph2', connectedGraph);
            workspace.addCollection('test-col-connected', connectedCollection);

            const connectedResult = await transpiler.transpile(connectedCollection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                connectedResult.code.includes('OUT_CONN_GUARD_ASSIGN(node_node1_out0)'),
                'Should emit guarded assignment when output is connected'
            );
            assert.deepEqual(
                outputConnectedFlags,
                [false, true],
                'Should provide connected=false/true output metadata across disconnected and connected cases'
            );

            delete global.OutputConnectionGuardGenerator;
        });

        it('should assign generator expressions directly without emitting output padding helper', async () => {
            global.GeneratorPaddingProbe = () => ({
                expression: 'gen_expr',
            });

            workspace.deviceRuntime.addNodeDefinition('generatorPad', {
                title: 'Generator Padding Probe',
                inputs: [{ id: 'in0', name: 'Input' }],
                outputs: [
                    { id: 'out0', name: 'First' },
                    { id: 'out1', name: 'Second' },
                ],
                controls: [],
                implementations: {
                    python: {
                        type: 'code-generator',
                        value: 'GeneratorPaddingProbe',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'GeneratorPaddingGraph');

            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'generatorPad',
                    inputs: [{ id: 'in0', name: 'Input' }],
                    outputs: [
                        { id: 'out0', name: 'First' },
                        { id: 'out1', name: 'Second' },
                    ],
                })
            );

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });
            const normalizedCode = result.code.replace(/\s+/g, '');

            assert.ok(
                normalizedCode.includes('node_node1_out0,node_node1_out1=gen_expr'),
                'Generator expressions should assign outputs directly'
            );
            assert.ok(
                !normalizedCode.includes('defmo_pad_outputs'),
                'Output padding helper should not be emitted for generator expressions'
            );

            delete global.GeneratorPaddingProbe;
        });

        it('should reject generator results without statement or expression', async () => {
            global.InvalidGeneratorReturnShape = () => ({});

            workspace.deviceRuntime.addNodeDefinition('invalidGeneratorShape', {
                title: 'Invalid Generator Shape',
                inputs: [],
                outputs: [{ id: 'out0', name: 'Result' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'code-generator',
                        value: 'InvalidGeneratorReturnShape',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'InvalidGeneratorShapeGraph');

            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'invalidGeneratorShape',
                    outputs: [{ id: 'out0', name: 'Result' }],
                })
            );

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            await assert.rejects(
                () =>
                    transpiler.transpile(collection, {
                        deviceRuntime: workspace.deviceRuntime,
                    }),
                /must return an object containing "statement" or "expression"/i
            );

            delete global.InvalidGeneratorReturnShape;
        });

        it('should preserve generator-provided outputs array for expression assignment', async () => {
            global.GeneratorOutputOverrideProbe = () => ({
                expression: 'generated_values()',
                outputs: ['custom_out_0', 'custom_out_1'],
            });

            workspace.deviceRuntime.addNodeDefinition('generatorOutputOverride', {
                title: 'Generator Output Override',
                inputs: [],
                outputs: [
                    { id: 'out0', name: 'First' },
                    { id: 'out1', name: 'Second' },
                ],
                controls: [],
                implementations: {
                    python: {
                        type: 'code-generator',
                        value: 'GeneratorOutputOverrideProbe',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'GeneratorOutputOverrideGraph');

            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'generatorOutputOverride',
                    outputs: [
                        { id: 'out0', name: 'First' },
                        { id: 'out1', name: 'Second' },
                    ],
                })
            );

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });
            const normalizedCode = result.code.replace(/\s+/g, '');

            assert.ok(
                normalizedCode.includes('custom_out_0,custom_out_1=generated_values()'),
                'Should use generator-provided outputs for assignment'
            );

            delete global.GeneratorOutputOverrideProbe;
        });

        it('should use graph trigger interval for sleep duration', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'IntervalGraph', 1234);

            const constNode = new MockNodeData({
                id: 'node1',
                type: 'const',
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [{ id: 'value', type: 'number' }],
                controlValues: { value: 42 },
            });
            graph.addNode('node1', constNode);

            collection.addGraph('graph1', graph);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes('_next_run_ms = _utime.ticks_add(_next_run_ms, 1234)'),
                'Should advance the loop deadline by the graph trigger interval'
            );
            assert.ok(
                result.code.includes(
                    '_wait_ms = _utime.ticks_diff(_next_run_ms, _utime.ticks_ms())'
                ),
                'Should wait for the remaining part of the interval'
            );
            assert.ok(
                result.code.includes('import utime as _utime'),
                'Should import the deadline helpers'
            );
            assert.equal(
                result.code.includes('await asyncio.sleep_ms(1234)'),
                false,
                'Should not sleep for the whole interval after the body'
            );
        });

        it('should place init statements inside graph function before loop', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'StatefulGraph');

            const statefulNode = new MockNodeData({
                id: 'node1',
                type: 'stateful',
                outputs: [{ id: 'out0', name: 'Value' }],
            });
            graph.addNode('node1', statefulNode);

            collection.addGraph('graph1', graph);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            const graphFunctionStart = result.code.indexOf('async def statefulgraph():');
            const initInsideFunction = result.code.indexOf('    STATE_NODE_A = 0');
            const whileLoopStart = result.code.indexOf('    while True:');

            assert.ok(graphFunctionStart >= 0, 'Should generate statefulgraph function');
            assert.ok(
                initInsideFunction > graphFunctionStart,
                'Init should be inside function scope'
            );
            assert.ok(
                whileLoopStart > initInsideFunction,
                'Init should appear before while loop in function'
            );
            assert.ok(
                !result.code.includes('\nSTATE_NODE_A = 0\n'),
                'Init should not be emitted at module scope'
            );
        });

        it('should schedule init-only and loop-only nodes into separate passes', async () => {
            workspace.deviceRuntime.addNodeDefinition('phaseInitConst', {
                title: 'Phase Init Const',
                inputs: [],
                outputs: [{ id: 'out0', name: 'Value', phase: 'init' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'regex',
                        value: '1',
                    },
                },
            });

            workspace.deviceRuntime.addNodeDefinition('phaseLoopConst', {
                title: 'Phase Loop Const',
                inputs: [],
                outputs: [{ id: 'out0', name: 'Value', phase: 'loop' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'regex',
                        value: '2',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'PhaseGraph');

            const initNode = new MockNodeData({
                id: 'node-init',
                type: 'phaseInitConst',
                outputs: [{ id: 'out0', name: 'Value', phase: 'init' }],
            });
            initNode.executionPhase = 'init';

            const loopNode = new MockNodeData({
                id: 'node-loop',
                type: 'phaseLoopConst',
                outputs: [{ id: 'out0', name: 'Value', phase: 'loop' }],
            });
            loopNode.executionPhase = 'loop';

            graph.addNode('node-init', initNode);
            graph.addNode('node-loop', loopNode);
            collection.addGraph('graph1', graph);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            const whileStart = result.code.indexOf('    while True:');
            const initComment = '# phaseInitConst [phaseInitConst]';
            const loopComment = '# phaseLoopConst [phaseLoopConst]';
            const initAssignment = 'node_node-init_out0 = 1';
            const loopAssignment = 'node_node-loop_out0 = 2';

            assert.ok(whileStart > 0, 'Graph should include while loop');

            const beforeWhile = result.code.slice(0, whileStart);
            const afterWhile = result.code.slice(whileStart);

            assert.ok(
                beforeWhile.includes(initComment),
                'Init-only node comment should be in init pass'
            );
            assert.ok(
                beforeWhile.includes(initAssignment),
                'Init-only node statement should be in init pass'
            );
            assert.ok(
                !afterWhile.includes(initAssignment),
                'Init-only node statement should not appear in loop pass'
            );

            assert.ok(
                afterWhile.includes(loopComment),
                'Loop-only node comment should be in loop pass'
            );
            assert.ok(
                afterWhile.includes(loopAssignment),
                'Loop-only node statement should be in loop pass'
            );
            assert.ok(
                !beforeWhile.includes(loopAssignment),
                'Loop-only node statement should not appear in init pass'
            );
        });

        it('should keep legacy nodes without executionPhase in loop pass', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'LegacyPhaseGraph');

            const constNode = new MockNodeData({
                id: 'node1',
                type: 'const',
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [{ id: 'value', type: 'number' }],
                controlValues: { value: 123 },
            });

            const printNode = new MockNodeData({
                id: 'node2',
                type: 'print',
                inputs: [{ id: 'in0', name: 'Value' }],
                controls: [{ id: 'label', type: 'text' }],
                controlValues: { label: 'Legacy:' },
            });

            graph.addNode('node1', constNode);
            graph.addNode('node2', printNode);
            graph.addConnection({
                fromNode: 'node1',
                fromIndex: 0,
                toNode: 'node2',
                toIndex: 0,
            });
            collection.addGraph('graph1', graph);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            const whileStart = result.code.indexOf('    while True:');
            assert.ok(whileStart > 0, 'Graph should include while loop');

            const beforeWhile = result.code.slice(0, whileStart);
            const afterWhile = result.code.slice(whileStart);

            assert.ok(
                !beforeWhile.includes('node_node1_out0 = 123'),
                'Legacy node output assignment should not be emitted in init pass'
            );
            assert.ok(
                afterWhile.includes('node_node1_out0 = 123'),
                'Legacy node output assignment should remain in loop pass'
            );
            assert.ok(
                afterWhile.includes("print('Legacy:', node_node1_out0)"),
                'Legacy downstream node should execute in loop pass'
            );
        });

        it('should use node definition executionPhase when node snapshot omits executionPhase', async () => {
            workspace.deviceRuntime.addNodeDefinition('phaseInitFromDefinition', {
                title: 'Phase Init From Definition',
                executionPhase: 'init',
                inputs: [],
                outputs: [{ id: 'out0', name: 'Value', phase: 'init' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'regex',
                        value: '7',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'LegacyPhaseFromDefinitionGraph');

            const legacyInitNode = new MockNodeData({
                id: 'node-legacy-init',
                type: 'phaseInitFromDefinition',
                outputs: [{ id: 'out0', name: 'Value' }],
            });

            graph.addNode('node-legacy-init', legacyInitNode);
            collection.addGraph('graph1', graph);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            const whileStart = result.code.indexOf('    while True:');
            assert.ok(whileStart > 0, 'Graph should include while loop');

            const beforeWhile = result.code.slice(0, whileStart);
            const afterWhile = result.code.slice(whileStart);

            assert.ok(
                beforeWhile.includes('node_node-legacy-init_out0 = 7'),
                'Node-definition init phase should place assignment in init pass'
            );
            assert.ok(
                !afterWhile.includes('node_node-legacy-init_out0 = 7'),
                'Node-definition init phase should prevent loop-pass assignment'
            );
        });

        it('should deduplicate identical shared init execute contributions', async () => {
            global.SharedInitExecuteGenerator = (context) => ({
                statement: `${context.outputs[0]} = 1`,
                init: {
                    execute: 'BOOTSTRAP_TOKEN = 99',
                    priority: 10,
                },
            });

            workspace.deviceRuntime.addNodeDefinition('shared-init-exec-node', {
                title: 'Shared Init Execute Node',
                executionPhase: 'both',
                inputs: [],
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'regex',
                        value: '1',
                    },
                },
                initImplementations: {
                    python: {
                        type: 'code-generator',
                        value: 'SharedInitExecuteGenerator',
                    },
                },
                initFunction: 'init_shared_runtime',
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'SharedInitDedupeGraph');

            graph.addNode(
                'nodeA',
                new MockNodeData({
                    id: 'nodeA',
                    type: 'shared-init-exec-node',
                    outputs: [{ id: 'out0', name: 'Value' }],
                })
            );

            graph.addNode(
                'nodeB',
                new MockNodeData({
                    id: 'nodeB',
                    type: 'shared-init-exec-node',
                    outputs: [{ id: 'out0', name: 'Value' }],
                })
            );

            collection.addGraph('graph1', graph);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            const bootstrapMatches = result.code.match(/BOOTSTRAP_TOKEN\s*=\s*99/g) || [];
            assert.equal(
                bootstrapMatches.length,
                1,
                'Identical shared init execute blocks should be emitted once'
            );

            delete global.SharedInitExecuteGenerator;
        });
    });

    describe('Input Defaults', () => {
        it('should use default value for disconnected input', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'DefaultGraph');

            const printNode = new MockNodeData({
                id: 'node1',
                type: 'print',
                inputs: [{ id: 'in0', name: 'Value' }],
                controls: [{ id: 'label', type: 'text' }],
                controlValues: { label: 'Default:' },
                inputDefaults: { in0: 999 },
            });
            graph.addNode('node1', printNode);

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes("print('Default:', 999)"),
                'Should use default value for disconnected input'
            );
        });

        it('should use None for input with no default', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'NoneGraph');

            const printNode = new MockNodeData({
                id: 'node1',
                type: 'print',
                inputs: [{ id: 'in0', name: 'Value' }],
                controls: [{ id: 'label', type: 'text' }],
                controlValues: { label: 'None:' },
            });
            graph.addNode('node1', printNode);

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes("print('None:', None)"),
                'Should use None for input without default'
            );
        });

        it('should use input defaultControl.default when inputDefaults value is missing', async () => {
            workspace.deviceRuntime.addNodeDefinition('printWithInputControlDefault', {
                title: 'Print With Input Control Default',
                inputs: [
                    {
                        id: 'in0',
                        name: 'Value',
                        defaultControl: {
                            id: 'in0',
                            type: 'number',
                            default: 99,
                        },
                    },
                ],
                outputs: [],
                controls: [],
                implementations: {
                    python: {
                        type: 'regex',
                        value: 'print({{in0}})',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'InputControlDefaultGraph');

            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'printWithInputControlDefault',
                    inputs: [
                        {
                            id: 'in0',
                            name: 'Value',
                            defaultControl: {
                                id: 'in0',
                                type: 'number',
                                default: 99,
                            },
                        },
                    ],
                    inputDefaults: {},
                })
            );

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes('print(99)'),
                'Should use defaultControl.default for disconnected input when inputDefaults is missing'
            );
        });

        it('should prioritize inputDefaults over input defaultControl.default', async () => {
            workspace.deviceRuntime.addNodeDefinition('printWithInputControlDefault', {
                title: 'Print With Input Control Default',
                inputs: [
                    {
                        id: 'in0',
                        name: 'Value',
                        defaultControl: {
                            id: 'in0',
                            type: 'number',
                            default: 99,
                        },
                    },
                ],
                outputs: [],
                controls: [],
                implementations: {
                    python: {
                        type: 'regex',
                        value: 'print({{in0}})',
                    },
                },
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'InputDefaultPriorityGraph');

            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'printWithInputControlDefault',
                    inputs: [
                        {
                            id: 'in0',
                            name: 'Value',
                            defaultControl: {
                                id: 'in0',
                                type: 'number',
                                default: 99,
                            },
                        },
                    ],
                    inputDefaults: { in0: 42 },
                })
            );

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes('print(42)'),
                'Should prefer inputDefaults over defaultControl.default'
            );
            assert.ok(
                !result.code.includes('print(99)'),
                'Should not use defaultControl when inputDefaults exists'
            );
        });
    });

    describe('Multiple Graphs', () => {
        it('should transpile multiple graphs in collection', async () => {
            const collection = new MockCollection('test-col', '1.0.0');

            const graph1 = new MockNodeGraph('graph1', 'Graph1');
            const node1 = new MockNodeData({
                id: 'node1',
                type: 'const',
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [{ id: 'value', type: 'number' }],
                controlValues: { value: 10 },
            });
            graph1.addNode('node1', node1);

            const graph2 = new MockNodeGraph('graph2', 'Graph2');
            const node2 = new MockNodeData({
                id: 'node1',
                type: 'const',
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [{ id: 'value', type: 'number' }],
                controlValues: { value: 20 },
            });
            graph2.addNode('node1', node2);

            collection.addGraph('graph1', graph1);
            collection.addGraph('graph2', graph2);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes('async def graph1'),
                'Should generate first graph function'
            );
            assert.ok(
                result.code.includes('async def graph2'),
                'Should generate second graph function'
            );
            assert.ok(result.code.includes('asyncio.gather'), 'Should run graphs concurrently');
        });

        it('transpiles webview helper contributions across graphs with repeated local node ids', async () => {
            const originalSelf = global.self;
            const originalWindow = global.window;
            const originalNodeCodeGenerators = global.NodeCodeGenerators;
            const originalNodeInitGenerators = global.NodeInitGenerators;
            const originalNodeHelperGenerators = global.NodeHelperGenerators;
            const originalNodeHelperHandoffConsumers = global.NodeHelperHandoffConsumers;

            try {
                global.self = global;
                delete global.window;
                global.NodeCodeGenerators = {};
                global.NodeInitGenerators = {};
                global.NodeHelperGenerators = {};
                global.NodeHelperHandoffConsumers = {};

                const generatorUrl = pathToFileURL(
                    path.resolve(
                        'src/micro_otter/nodes/device/node_pkgs/webview/node_generators.js'
                    )
                );
                await import(`${generatorUrl.href}?test=transpiler-webview-multi-graph`);

                workspace.deviceRuntime.addNodeDefinition('web-root-node', {
                    title: 'Web Root',
                    inputs: [],
                    outputs: [],
                    controls: [
                        { id: 'title', type: 'text' },
                        { id: 'refreshIntervalMs', type: 'number' },
                    ],
                    implementations: {
                        python: {
                            type: 'regex',
                            value: 'None',
                        },
                    },
                    initImplementations: {
                        python: {
                            type: 'regex',
                            value: 'None',
                        },
                    },
                    helperImplementations: {
                        python: {
                            type: 'helper-generator',
                            value: 'NodeHelperGenerators.webviewRoot',
                            helperGroup: 'web-runtime',
                        },
                    },
                    initFunction: 'init_webview',
                });

                workspace.deviceRuntime.addNodeDefinition('web-page-node', {
                    title: 'Web Page',
                    inputs: [],
                    outputs: [],
                    controls: [{ id: 'pageName', type: 'text' }],
                    implementations: {
                        python: {
                            type: 'regex',
                            value: 'None',
                        },
                    },
                    initImplementations: {
                        python: {
                            type: 'regex',
                            value: 'None',
                        },
                    },
                    helperImplementations: {
                        python: {
                            type: 'helper-generator',
                            value: 'NodeHelperGenerators.webviewPage',
                            helperGroup: 'web-runtime',
                        },
                    },
                    initFunction: 'init_webview',
                });

                workspace.deviceRuntime.addNodeDefinition('web-content-node', {
                    title: 'Web Content',
                    inputs: [
                        { id: 'parent', name: 'Parent', type: 'layout' },
                        { id: 'title', name: 'Title', type: 'string' },
                        { id: 'value', name: 'Value', type: 'any' },
                    ],
                    outputs: [{ id: 'out0', name: 'Out' }],
                    controls: [{ id: 'contentType', type: 'text' }],
                    implementations: {
                        python: {
                            type: 'code-generator',
                            value: 'NodeCodeGenerators.webviewContent',
                        },
                    },
                    initImplementations: {
                        python: {
                            type: 'code-generator',
                            value: 'NodeInitGenerators.webviewContent',
                        },
                    },
                    helperImplementations: {
                        python: {
                            type: 'helper-generator',
                            value: 'NodeHelperGenerators.webviewContent',
                            helperGroup: 'web-runtime',
                        },
                    },
                    initFunction: 'init_webview',
                });

                const collection = new MockCollection('webview-col', '1.0.0');
                collection.webAssetGenerationMode = 'plain';

                const graph1 = new MockNodeGraph('graph1', 'Graph1');
                graph1.addNode(
                    '1',
                    new MockNodeData({
                        id: '1',
                        type: 'web-root-node',
                        controls: [
                            { id: 'title', type: 'text' },
                            { id: 'refreshIntervalMs', type: 'number' },
                        ],
                        controlValues: {
                            title: 'Main',
                            refreshIntervalMs: 1000,
                        },
                    })
                );
                graph1.addNode(
                    '2',
                    new MockNodeData({
                        id: '2',
                        type: 'web-content-node',
                        controls: [{ id: 'contentType', type: 'text' }],
                        controlValues: {
                            contentType: 'content',
                        },
                    })
                );

                const graph2 = new MockNodeGraph('graph2', 'Graph2');
                graph2.addNode(
                    '1',
                    new MockNodeData({
                        id: '1',
                        type: 'web-page-node',
                        controls: [{ id: 'pageName', type: 'text' }],
                        controlValues: {
                            pageName: 'Reports',
                        },
                    })
                );
                graph2.addNode(
                    '2',
                    new MockNodeData({
                        id: '2',
                        type: 'web-content-node',
                        controls: [{ id: 'contentType', type: 'text' }],
                        controlValues: {
                            contentType: 'content',
                        },
                    })
                );

                collection.addGraph('graph1', graph1);
                collection.addGraph('graph2', graph2);

                const result = await transpiler.transpile(collection, {
                    deviceRuntime: workspace.deviceRuntime,
                });

                const generatedArtifacts = Array.isArray(result.generatedArtifacts)
                    ? result.generatedArtifacts
                    : [];
                const layoutArtifact = generatedArtifacts.find(
                    (artifact) => artifact.targetPath === 'collection/webview_layout_model.json'
                );
                const htmlArtifact = generatedArtifacts.find((artifact) => {
                    const targetPath = String(artifact?.targetPath || '');
                    return (
                        targetPath === 'collection/webview/webview-col/index.html' ||
                        targetPath === 'collection/webview/webview-col/index.html.gz'
                    );
                });

                assert.ok(layoutArtifact, 'Should generate webview layout artifact');
                assert.ok(htmlArtifact, 'Should generate webview HTML artifact');

                const layoutModel = JSON.parse(String(layoutArtifact.content));
                assert.deepEqual(layoutModel?.pageIdentity?.pageIdsByNodeId, {
                    'graph1:1': 'wv_page_root_graph1_1',
                    'graph2:1': 'wv_page_page_graph2_1',
                });
                assert.equal(layoutModel?.pageIdentity?.rootPageId, 'wv_page_root_graph1_1');
                assert.ok(layoutModel?.elements?.['node:graph1:1']);
                assert.ok(layoutModel?.elements?.['node:graph2:1']);
                assert.equal(layoutModel?.elements?.['node:graph1:1']?.rawNodeId, '1');
                assert.equal(layoutModel?.elements?.['node:graph2:1']?.rawNodeId, '1');

                assert.deepEqual(layoutModel?.root?.navigation, [
                    'wv_page_root_graph1_1',
                    'wv_page_page_graph2_1',
                ]);
                assert.ok(
                    result.code.includes('wv_bind_content_graph1_2'),
                    'Expected graph-scoped refresh key for graph1 content node'
                );
                assert.ok(
                    result.code.includes('wv_bind_content_graph2_2'),
                    'Expected graph-scoped refresh key for graph2 content node'
                );
            } finally {
                if (originalSelf === undefined) {
                    delete global.self;
                } else {
                    global.self = originalSelf;
                }

                if (originalWindow === undefined) {
                    delete global.window;
                } else {
                    global.window = originalWindow;
                }

                if (originalNodeCodeGenerators === undefined) {
                    delete global.NodeCodeGenerators;
                } else {
                    global.NodeCodeGenerators = originalNodeCodeGenerators;
                }

                if (originalNodeInitGenerators === undefined) {
                    delete global.NodeInitGenerators;
                } else {
                    global.NodeInitGenerators = originalNodeInitGenerators;
                }

                if (originalNodeHelperGenerators === undefined) {
                    delete global.NodeHelperGenerators;
                } else {
                    global.NodeHelperGenerators = originalNodeHelperGenerators;
                }

                if (originalNodeHelperHandoffConsumers === undefined) {
                    delete global.NodeHelperHandoffConsumers;
                } else {
                    global.NodeHelperHandoffConsumers = originalNodeHelperHandoffConsumers;
                }
            }
        });

        it('transpiles webview persist controls and value-store nodes', async () => {
            const originals = {
                self: global.self,
                window: global.window,
                NodeCodeGenerators: global.NodeCodeGenerators,
                NodeInitGenerators: global.NodeInitGenerators,
                NodeHelperGenerators: global.NodeHelperGenerators,
                NodeHelperHandoffConsumers: global.NodeHelperHandoffConsumers,
            };

            try {
                global.self = global;
                delete global.window;
                global.NodeCodeGenerators = {};
                global.NodeInitGenerators = {};
                global.NodeHelperGenerators = {};
                global.NodeHelperHandoffConsumers = {};

                const packageRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/webview');
                const generatorModules = [
                    'generator_webview_shared.js',
                    'generator_number_input.js',
                    'generator_checkbox.js',
                    'generator_select.js',
                    'generator_value_store.js',
                ];
                for (const moduleFile of generatorModules) {
                    const moduleUrl = pathToFileURL(path.join(packageRoot, moduleFile));
                    await import(`${moduleUrl.href}?test=transpiler-webview-persist`);
                }

                const definitionsPath = path.resolve(
                    'src/micro_otter/nodes/device/node_pkgs/webview/node_definitions.json'
                );
                const nodeTypes = JSON.parse(readFileSync(definitionsPath, 'utf8')).nodeTypes;
                const supportedIds = [
                    'web-view-number-input',
                    'web-view-checkbox',
                    'web-view-select',
                    'web-store-read',
                    'web-store-write',
                    'web-store-save',
                    'web-store-load',
                ];
                for (const shortId of supportedIds) {
                    workspace.deviceRuntime.addNodeDefinition(
                        `webview.${shortId}`,
                        nodeTypes[shortId]
                    );
                }

                const makeNode = (shortId, id, controlValues) => {
                    const definition = nodeTypes[shortId];
                    return new MockNodeData({
                        id,
                        type: `webview.${shortId}`,
                        inputs: (definition.inputs || []).map((input) => ({ ...input })),
                        outputs: (definition.outputs || []).map((output) => ({ ...output })),
                        controls: (definition.controls || []).map((control) => ({ ...control })),
                        controlValues,
                    });
                };

                const persistOffCollection = new MockCollection('persist-off', '1.0.0');
                persistOffCollection.webAssetGenerationMode = 'plain';
                const persistOffGraph = new MockNodeGraph('graph1', 'Graph1');
                persistOffGraph.addNode(
                    '1',
                    makeNode('web-view-number-input', '1', { value: 0, persist: false })
                );
                persistOffCollection.addGraph('graph1', persistOffGraph);

                const persistOffResult = await transpiler.transpile(persistOffCollection, {
                    deviceRuntime: workspace.deviceRuntime,
                });

                assert.ok(
                    !persistOffResult.code.includes('import otter_vars.store'),
                    'persist off must not import the value store'
                );
                assert.ok(
                    persistOffResult.code.includes(
                        '.update(0, web_interface_module.WEB_INTERFACE.consume_webview_values_keys'
                    ),
                    'persist off must keep the literal default in update()'
                );

                const collection = new MockCollection('webview-persist', '1.0.0');
                collection.webAssetGenerationMode = 'plain';
                const graph1 = new MockNodeGraph('graph1', 'Graph1');
                graph1.addNode(
                    '1',
                    makeNode('web-view-number-input', '1', { value: 0, persist: true })
                );
                graph1.addNode(
                    '2',
                    makeNode('web-view-checkbox', '2', { value: false, persist: true })
                );
                graph1.addNode(
                    '3',
                    makeNode('web-view-select', '3', {
                        optionCount: 2,
                        defaultIndex: 1,
                        persist: true,
                        value_1: 'a',
                        value_2: 'b',
                        label_1: 'A',
                        label_2: 'B',
                    })
                );
                graph1.addNode('4', makeNode('web-store-read', '4', { name: 'speed' }));
                graph1.addNode('5', makeNode('web-store-write', '5', { name: 'speed' }));
                graph1.addNode('6', makeNode('web-store-save', '6', {}));
                graph1.addNode('7', makeNode('web-store-load', '7', {}));
                collection.addGraph('graph1', graph1);

                const result = await transpiler.transpile(collection, {
                    deviceRuntime: workspace.deviceRuntime,
                });
                const code = result.code;

                assert.ok(
                    code.includes("_store.get('_webcontrol', 'graph1:1', 0)"),
                    'Expected the number input to read the store'
                );
                assert.ok(
                    code.includes(
                        "_store.set('_webcontrol', 'graph1:1', _wv_numinput_out_graph1_1)"
                    ),
                    'Expected the number input to write the store'
                );
                assert.ok(
                    code.indexOf("_store.set('_webcontrol', 'graph1:1'") >
                        code.indexOf('.update(_store.get('),
                    'Expected the number input write after its update()'
                );

                const initStart = code.indexOf('def init_webview():');
                assert.ok(initStart >= 0, 'Expected an init_webview function');
                const initRest = code.slice(initStart + 'def init_webview():'.length);
                const nextTopLevelDefinition = initRest.search(/\n(?:async )?def /);
                const initBody =
                    nextTopLevelDefinition >= 0
                        ? initRest.slice(0, nextTopLevelDefinition)
                        : initRest;
                assert.ok(
                    initBody.includes('DualInputControl(0, 0, 100)'),
                    'Expected literal init default with bounds'
                );
                assert.ok(!initBody.includes('_store'), 'init must not touch the value store');
                assert.ok(
                    code.indexOf('_store.get(') > code.indexOf('async def graph1'),
                    'Expected store reads inside the graph loop, not in init'
                );

                assert.ok(
                    code.includes(
                        "_wv_select_persistidx_graph1_3 = _store.get('_webcontrol', 'graph1:3', 1)"
                    ),
                    'Expected the select index read'
                );
                assert.ok(
                    code.includes('_wv_select_backend_graph1_3 = '),
                    'Expected the select backend fallback assignment'
                );
                assert.ok(
                    code.includes(
                        'if isinstance(_wv_select_persistidx_graph1_3, int) and 0 <= ' +
                            '_wv_select_persistidx_graph1_3 < len(_wv_select_vals_graph1_3):'
                    ),
                    'Expected the select index range guard'
                );
                assert.ok(
                    code.includes('update(_wv_select_backend_graph1_3,'),
                    'Expected the resolved select value in update()'
                );
                assert.ok(
                    code.includes(
                        "_store.set('_webcontrol', 'graph1:3', " +
                            '_wv_select_ctrl_graph1_3._selected_index)'
                    ),
                    'Expected the select index write-back'
                );

                assert.ok(
                    code.includes("_store.get('_webcontrol', 'speed', "),
                    'Expected the value-store read node'
                );
                assert.ok(
                    code.includes("_store.set('_webcontrol', 'speed', "),
                    'Expected the value-store write node'
                );
                assert.match(
                    code,
                    /if _store\.edge_trigger\('save:graph1:6', False\):\n\s+_store\.save\('_webcontrol'\)/,
                    'Expected the value-store save node'
                );
                assert.match(
                    code,
                    /if _store\.edge_trigger\('load:graph1:7', True\):\n\s+_store\.load\('_webcontrol'\)/,
                    'Expected the value-store load node to default to true'
                );

                assert.equal(
                    (code.match(/^import otter_vars\.store as _store$/gm) || []).length,
                    1,
                    'Expected exactly one value store import'
                );
            } finally {
                for (const [key, value] of Object.entries(originals)) {
                    if (value === undefined) {
                        delete global[key];
                    } else {
                        global[key] = value;
                    }
                }
            }
        });

        it('emits shared init function and awaits it before starting graph tasks', async () => {
            workspace.deviceRuntime.addNodeDefinition('shared-init-node', {
                title: 'Shared Init Node',
                inputs: [],
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'regex',
                        value: 'SHARED_INIT_STATE',
                    },
                },
                initImplementations: {
                    python: {
                        type: 'regex',
                        value: "if 'SHARED_INIT_STATE' not in globals():\n    SHARED_INIT_STATE = 0",
                    },
                },
                initFunction: 'init_shared_state',
            });

            const collection = new MockCollection('test-col', '1.0.0');

            const graph1 = new MockNodeGraph('graph1', 'Graph1');
            graph1.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'shared-init-node',
                    outputs: [{ id: 'out0', name: 'Value' }],
                })
            );

            const graph2 = new MockNodeGraph('graph2', 'Graph2');
            graph2.addNode(
                'node2',
                new MockNodeData({
                    id: 'node2',
                    type: 'shared-init-node',
                    outputs: [{ id: 'out0', name: 'Value' }],
                })
            );

            collection.addGraph('graph1', graph1);
            collection.addGraph('graph2', graph2);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes('async def init_shared_state():'),
                'Should emit shared init function from initFunction bucket'
            );
            assert.ok(
                result.code.includes('global SHARED_INIT_STATE'),
                'Should declare init-assigned globals as global in shared init function'
            );

            const awaitInitIndex = result.code.indexOf('await init_shared_state()');
            const createTaskIndex = result.code.indexOf('asyncio.create_task(');
            assert.ok(awaitInitIndex >= 0, 'Should await shared init function in run()');
            assert.ok(createTaskIndex >= 0, 'Should create graph tasks for multi-graph run()');
            assert.ok(
                awaitInitIndex < createTaskIndex,
                'Should await shared init function before graph tasks are created'
            );
        });

        it('declares only referenced globals in shared init function', async () => {
            workspace.deviceRuntime.addNodeDefinition('shared-init-filtered', {
                title: 'Shared Init Filtered',
                inputs: [],
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'regex',
                        value: 'SHARED_USED',
                    },
                },
                initImplementations: {
                    python: {
                        type: 'regex',
                        value: 'SHARED_USED = 1\nSHARED_UNUSED = 2',
                    },
                },
                initFunction: 'init_shared_filtered',
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'Graph1');
            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'shared-init-filtered',
                    outputs: [{ id: 'out0', name: 'Value' }],
                })
            );
            collection.addGraph('graph1', graph);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes('async def init_shared_filtered():'),
                'Should emit shared init function'
            );
            assert.ok(
                result.code.includes('global SHARED_USED'),
                'Should declare global for referenced shared value'
            );
            assert.ok(
                !result.code.includes('global SHARED_UNUSED') &&
                    !result.code.includes('SHARED_USED, SHARED_UNUSED'),
                'Should not declare globals for init assignments never referenced outside init function'
            );
        });

        it('orders structured init blocks by priority and execute blocks by graph order', async () => {
            global.StructuredInitGenerator = (context) => {
                const controlValues = context?.node?.controlValues || {};
                const initLabel = String(controlValues.initLabel || 'X');
                const executeLabel = String(controlValues.executeLabel || 'X');
                const initPriority = Number(controlValues.initPriority || 100);
                return {
                    init: {
                        block: `INIT_${initLabel} = True`,
                        priority: initPriority,
                        execute: `EXEC_${executeLabel} = True`,
                    },
                    outputs: context.outputs,
                };
            };

            workspace.deviceRuntime.addNodeDefinition('shared-init-structured', {
                title: 'Shared Init Structured',
                inputs: [{ id: 'in0', name: 'Input' }],
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [
                    { id: 'initLabel', type: 'text' },
                    { id: 'executeLabel', type: 'text' },
                    { id: 'initPriority', type: 'number' },
                ],
                implementations: {
                    python: {
                        type: 'regex',
                        value: '1',
                    },
                },
                initImplementations: {
                    python: {
                        type: 'code-generator',
                        value: 'StructuredInitGenerator',
                    },
                },
                initFunction: 'init_structured_state',
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'Graph1');

            graph.addNode(
                'nodeA',
                new MockNodeData({
                    id: 'nodeA',
                    type: 'shared-init-structured',
                    inputs: [{ id: 'in0', name: 'Input' }],
                    outputs: [{ id: 'out0', name: 'Value' }],
                    controls: [
                        { id: 'initLabel', type: 'text' },
                        { id: 'executeLabel', type: 'text' },
                        { id: 'initPriority', type: 'number' },
                    ],
                    controlValues: {
                        initLabel: 'A',
                        executeLabel: 'A',
                        initPriority: 10,
                    },
                })
            );

            graph.addNode(
                'nodeB',
                new MockNodeData({
                    id: 'nodeB',
                    type: 'shared-init-structured',
                    inputs: [{ id: 'in0', name: 'Input' }],
                    outputs: [{ id: 'out0', name: 'Value' }],
                    controls: [
                        { id: 'initLabel', type: 'text' },
                        { id: 'executeLabel', type: 'text' },
                        { id: 'initPriority', type: 'number' },
                    ],
                    controlValues: {
                        initLabel: 'B',
                        executeLabel: 'B',
                        initPriority: 1,
                    },
                })
            );

            graph.addConnection({ fromNode: 'nodeA', fromIndex: 0, toNode: 'nodeB', toIndex: 0 });
            collection.addGraph('graph1', graph);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            const initBlockAIndex = result.code.indexOf('INIT_A = True');
            const initBlockBIndex = result.code.indexOf('INIT_B = True');
            const executeBlockAIndex = result.code.indexOf('EXEC_A = True');
            const executeBlockBIndex = result.code.indexOf('EXEC_B = True');

            assert.ok(initBlockAIndex >= 0 && initBlockBIndex >= 0, 'Should emit init blocks');
            assert.ok(
                executeBlockAIndex >= 0 && executeBlockBIndex >= 0,
                'Should emit execute blocks'
            );
            assert.ok(
                initBlockBIndex < initBlockAIndex,
                'Init blocks should be ordered by priority'
            );
            assert.ok(
                initBlockAIndex < executeBlockAIndex,
                'All init blocks should be emitted before execute blocks'
            );
            assert.ok(
                executeBlockAIndex < executeBlockBIndex,
                'Execute blocks should preserve graph/topological order'
            );

            delete global.StructuredInitGenerator;
        });

        it('falls back to default init priority for non-finite values and keeps deterministic tie order', async () => {
            global.StructuredInitPriorityFallbackGenerator = (context) => {
                const controlValues = context?.node?.controlValues || {};
                const label = String(controlValues.label || 'X');
                const initPriority = controlValues.initPriority;
                return {
                    init: {
                        block: `PRIORITY_${label} = True`,
                        priority: initPriority,
                        execute: `PRIORITY_EXEC_${label} = True`,
                    },
                    outputs: context.outputs,
                };
            };

            workspace.deviceRuntime.addNodeDefinition('shared-init-priority-fallback', {
                title: 'Shared Init Priority Fallback',
                inputs: [{ id: 'in0', name: 'Input' }],
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [
                    { id: 'label', type: 'text' },
                    { id: 'initPriority', type: 'number' },
                ],
                implementations: {
                    python: {
                        type: 'regex',
                        value: '1',
                    },
                },
                initImplementations: {
                    python: {
                        type: 'code-generator',
                        value: 'StructuredInitPriorityFallbackGenerator',
                    },
                },
                initFunction: 'init_priority_fallback',
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'Graph1');

            graph.addNode(
                'nodeA',
                new MockNodeData({
                    id: 'nodeA',
                    type: 'shared-init-priority-fallback',
                    inputs: [{ id: 'in0', name: 'Input' }],
                    outputs: [{ id: 'out0', name: 'Value' }],
                    controls: [
                        { id: 'label', type: 'text' },
                        { id: 'initPriority', type: 'number' },
                    ],
                    controlValues: {
                        label: 'A',
                        initPriority: Number.NaN,
                    },
                })
            );

            graph.addNode(
                'nodeB',
                new MockNodeData({
                    id: 'nodeB',
                    type: 'shared-init-priority-fallback',
                    inputs: [{ id: 'in0', name: 'Input' }],
                    outputs: [{ id: 'out0', name: 'Value' }],
                    controls: [
                        { id: 'label', type: 'text' },
                        { id: 'initPriority', type: 'number' },
                    ],
                    controlValues: {
                        label: 'B',
                        initPriority: Infinity,
                    },
                })
            );

            graph.addConnection({ fromNode: 'nodeA', fromIndex: 0, toNode: 'nodeB', toIndex: 0 });
            collection.addGraph('graph1', graph);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            const initAIndex = result.code.indexOf('PRIORITY_A = True');
            const initBIndex = result.code.indexOf('PRIORITY_B = True');
            assert.ok(initAIndex >= 0 && initBIndex >= 0, 'Should emit both init blocks');
            assert.ok(
                initAIndex < initBIndex,
                'Tie with defaulted priority should preserve deterministic node order'
            );

            delete global.StructuredInitPriorityFallbackGenerator;
        });

        it('uses legacy statement when init payload is malformed', async () => {
            global.MalformedInitPayloadGenerator = () => ({
                init: 'invalid-init-payload',
                statement: 'LEGACY_FALLBACK_OK = True',
            });

            workspace.deviceRuntime.addNodeDefinition('shared-init-malformed-fallback', {
                title: 'Shared Init Malformed Fallback',
                inputs: [],
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'regex',
                        value: '1',
                    },
                },
                initImplementations: {
                    python: {
                        type: 'code-generator',
                        value: 'MalformedInitPayloadGenerator',
                    },
                },
                initFunction: 'init_malformed_payload',
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'Graph1');
            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'shared-init-malformed-fallback',
                    outputs: [{ id: 'out0', name: 'Value' }],
                })
            );
            collection.addGraph('graph1', graph);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes('async def init_malformed_payload():'),
                'Should still emit shared init function bucket'
            );
            assert.ok(
                result.code.includes('LEGACY_FALLBACK_OK = True'),
                'Should fall back to legacy statement when init payload is malformed'
            );

            delete global.MalformedInitPayloadGenerator;
        });

        it('keeps legacy init code-generator behavior for initFunction buckets', async () => {
            global.LegacyInitStatementGenerator = () => ({
                statement: 'LEGACY_INIT_EXECUTE = 123',
            });

            workspace.deviceRuntime.addNodeDefinition('shared-init-legacy-generator', {
                title: 'Shared Init Legacy Generator',
                inputs: [],
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'regex',
                        value: 'LEGACY_INIT_EXECUTE',
                    },
                },
                initImplementations: {
                    python: {
                        type: 'code-generator',
                        value: 'LegacyInitStatementGenerator',
                    },
                },
                initFunction: 'init_legacy_generator',
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'Graph1');
            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'shared-init-legacy-generator',
                    outputs: [{ id: 'out0', name: 'Value' }],
                })
            );
            collection.addGraph('graph1', graph);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                result.code.includes('async def init_legacy_generator():'),
                'Should emit shared init function'
            );
            assert.ok(
                result.code.includes('LEGACY_INIT_EXECUTE = 123'),
                'Should preserve legacy statement-only init generator behavior'
            );

            delete global.LegacyInitStatementGenerator;
        });
    });

    describe('Helper Contribution Handoff', () => {
        it('collects helper-generator contributions with deterministic ordering', async () => {
            global.HelperContributionGenerator = (context) => {
                const controlValues = context?.node?.controlValues || {};
                const name = String(controlValues.name || 'unknown');
                const priority = Number(controlValues.priority || 100);
                const orderKey = String(controlValues.orderKey || '');

                return {
                    schemaVersion: 'transpiler-helper-contribution/v1',
                    priority,
                    orderKey,
                    data: {
                        [`page_${name}`]: `/pages/${name}`,
                    },
                    artifacts: [
                        {
                            targetPath: `app/${name}.py`,
                            content: `# generated ${name}`,
                            contentType: 'text/x-python',
                            role: 'generated-hook',
                        },
                    ],
                    webserverSpecPatch: {
                        [`route_${name}`]: `/api/${name}`,
                    },
                };
            };

            workspace.deviceRuntime.addNodeDefinition('helper-contrib-node', {
                title: 'Helper Contrib Node',
                inputs: [],
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [
                    { id: 'name', type: 'text' },
                    { id: 'priority', type: 'number' },
                    { id: 'orderKey', type: 'text' },
                ],
                implementations: {
                    python: {
                        type: 'regex',
                        value: '1',
                    },
                },
                helperImplementations: {
                    python: {
                        type: 'helper-generator',
                        value: 'HelperContributionGenerator',
                        helperGroup: 'web-runtime',
                    },
                },
            });

            const collection = new MockCollection('helper-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'HelperGraph');
            graph.addNode(
                'nodeA',
                new MockNodeData({
                    id: 'nodeA',
                    type: 'helper-contrib-node',
                    outputs: [{ id: 'out0', name: 'Value' }],
                    controls: [
                        { id: 'name', type: 'text' },
                        { id: 'priority', type: 'number' },
                        { id: 'orderKey', type: 'text' },
                    ],
                    controlValues: {
                        name: 'alpha',
                        priority: 20,
                        orderKey: 'b',
                    },
                })
            );
            graph.addNode(
                'nodeB',
                new MockNodeData({
                    id: 'nodeB',
                    type: 'helper-contrib-node',
                    outputs: [{ id: 'out0', name: 'Value' }],
                    controls: [
                        { id: 'name', type: 'text' },
                        { id: 'priority', type: 'number' },
                        { id: 'orderKey', type: 'text' },
                    ],
                    controlValues: {
                        name: 'beta',
                        priority: 10,
                        orderKey: 'a',
                    },
                })
            );
            collection.addGraph('graph1', graph);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            const helperGroup = result.helperHandoff?.helperGroups?.['web-runtime'];
            assert.ok(helperGroup, 'Should expose helper handoff group');
            assert.equal(helperGroup.artifacts.length, 2, 'Should aggregate helper artifacts');
            assert.equal(
                helperGroup.artifacts[0].targetPath,
                'app/beta.py',
                'Should order artifacts by helper priority and order key'
            );
            assert.equal(
                helperGroup.artifacts[1].targetPath,
                'app/alpha.py',
                'Should preserve deterministic artifact order'
            );
            assert.equal(
                result.generatedArtifacts?.length,
                2,
                'Should expose generatedArtifacts in transpile result'
            );
            assert.equal(
                result.assets?.generatedArtifacts?.length,
                2,
                'Should mirror generatedArtifacts into assets for deploy pipeline'
            );

            delete global.HelperContributionGenerator;
        });

        it('executes helper-group consumers and appends generated artifacts', async () => {
            global.HelperConsumerContributionGenerator = (context) => {
                const controlValues = context?.node?.controlValues || {};
                const route = String(controlValues.route || '/api/webview/refresh');

                return {
                    schemaVersion: 'transpiler-helper-contribution/v1',
                    helperGroup: 'web-runtime',
                    webserverSpecPatch: {
                        postRefreshRoute: route,
                    },
                };
            };

            global.NodeHelperHandoffConsumers = {
                'web-runtime': async (context) => {
                    const route = String(
                        context?.group?.webserverSpecPatch?.postRefreshRoute ||
                            '/api/webview/refresh'
                    );
                    return {
                        artifacts: [
                            {
                                targetPath: 'app/webserver_hooks_generated.py',
                                content: `# generated hook\nPOST_ROUTE = ${JSON.stringify(route)}\n`,
                                contentType: 'text/x-python',
                                role: 'generated-hook-module',
                            },
                            {
                                targetPath: 'collection/webview_runtime_flags.json',
                                content: JSON.stringify({
                                    needsWebDataStore: true,
                                    postRefreshRoute: route,
                                }),
                                contentType: 'application/json',
                                role: 'runtime-flags',
                            },
                        ],
                    };
                },
            };

            workspace.deviceRuntime.addNodeDefinition('helper-consumer-node', {
                title: 'Helper Consumer Node',
                inputs: [],
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [{ id: 'route', type: 'text' }],
                implementations: {
                    python: {
                        type: 'regex',
                        value: '1',
                    },
                },
                helperImplementations: {
                    python: {
                        type: 'helper-generator',
                        value: 'HelperConsumerContributionGenerator',
                        helperGroup: 'web-runtime',
                    },
                },
            });

            const collection = new MockCollection('helper-consumer-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'HelperConsumerGraph');
            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'helper-consumer-node',
                    outputs: [{ id: 'out0', name: 'Value' }],
                    controls: [{ id: 'route', type: 'text' }],
                    controlValues: {
                        route: '/api/custom-refresh',
                    },
                })
            );
            collection.addGraph('graph1', graph);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            const paths = (result.generatedArtifacts || []).map((artifact) => artifact.targetPath);
            assert.ok(
                paths.includes('app/webserver_hooks_generated.py'),
                'Should include generated hook-module artifact from helper consumer'
            );
            assert.ok(
                paths.includes('collection/webview_runtime_flags.json'),
                'Should include generated runtime flags artifact from helper consumer'
            );

            delete global.HelperConsumerContributionGenerator;
            delete global.NodeHelperHandoffConsumers;
        });

        it('rejects invalid helper-group consumer artifacts shape', async () => {
            global.HelperConsumerInvalidContributionGenerator = () => ({
                schemaVersion: 'transpiler-helper-contribution/v1',
                helperGroup: 'web-runtime',
            });

            global.NodeHelperHandoffConsumers = {
                'web-runtime': () => ({
                    artifacts: {
                        targetPath: 'app/webserver_hooks_generated.py',
                        content: '# invalid',
                    },
                }),
            };

            workspace.deviceRuntime.addNodeDefinition('helper-consumer-invalid-node', {
                title: 'Helper Consumer Invalid Node',
                inputs: [],
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'regex',
                        value: '1',
                    },
                },
                helperImplementations: {
                    python: {
                        type: 'helper-generator',
                        value: 'HelperConsumerInvalidContributionGenerator',
                        helperGroup: 'web-runtime',
                    },
                },
            });

            const collection = new MockCollection('helper-consumer-invalid-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'HelperConsumerInvalidGraph');
            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'helper-consumer-invalid-node',
                    outputs: [{ id: 'out0', name: 'Value' }],
                })
            );
            collection.addGraph('graph1', graph);

            await assert.rejects(
                () =>
                    transpiler.transpile(collection, {
                        deviceRuntime: workspace.deviceRuntime,
                    }),
                /invalid artifacts; expected array/,
                'Should reject consumer results that do not return artifacts array'
            );

            delete global.HelperConsumerInvalidContributionGenerator;
            delete global.NodeHelperHandoffConsumers;
        });

        it('rejects helper contributions with invalid schemaVersion', async () => {
            global.InvalidHelperContributionGenerator = () => ({
                helperGroup: 'web-runtime',
            });

            workspace.deviceRuntime.addNodeDefinition('helper-invalid-schema-node', {
                title: 'Helper Invalid Schema Node',
                inputs: [],
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [],
                implementations: {
                    python: {
                        type: 'regex',
                        value: '1',
                    },
                },
                helperImplementations: {
                    python: {
                        type: 'helper-generator',
                        value: 'InvalidHelperContributionGenerator',
                        helperGroup: 'web-runtime',
                    },
                },
            });

            const collection = new MockCollection('helper-invalid', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'HelperInvalidGraph');
            graph.addNode(
                'node1',
                new MockNodeData({
                    id: 'node1',
                    type: 'helper-invalid-schema-node',
                    outputs: [{ id: 'out0', name: 'Value' }],
                })
            );
            collection.addGraph('graph1', graph);

            await assert.rejects(
                () =>
                    transpiler.transpile(collection, {
                        deviceRuntime: workspace.deviceRuntime,
                    }),
                /schemaVersion/,
                'Should reject helper contributions without schemaVersion'
            );

            delete global.InvalidHelperContributionGenerator;
        });
    });

    describe('Progress Events', () => {
        it('should emit START, UPDATE, and COMPLETE events', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'TestGraph');
            const node = new MockNodeData({
                id: 'node1',
                type: 'const',
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [{ id: 'value', type: 'number' }],
                controlValues: { value: 42 },
            });
            graph.addNode('node1', node);
            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            const startEvents = progressEvents.filter((e) => e.type === ProgressEventType.START);
            const updateEvents = progressEvents.filter((e) => e.type === ProgressEventType.UPDATE);
            const completeEvents = progressEvents.filter(
                (e) => e.type === ProgressEventType.COMPLETE
            );

            assert.equal(startEvents.length, 1, 'Should emit one START event');
            assert.ok(updateEvents.length >= 1, 'Should emit at least one UPDATE event');
            assert.equal(completeEvents.length, 1, 'Should emit one COMPLETE event');
        });

        it('should emit ERROR event on failure', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'BadGraph');

            // Create cyclic graph
            const node1 = new MockNodeData({
                id: 'node1',
                type: 'scale',
                inputs: [{ id: 'in0', name: 'Value' }],
                outputs: [{ id: 'out0', name: 'Result' }],
                controls: [{ id: 'factor', type: 'number' }],
                controlValues: { factor: 2 },
            });
            const node2 = new MockNodeData({
                id: 'node2',
                type: 'scale',
                inputs: [{ id: 'in0', name: 'Value' }],
                outputs: [{ id: 'out0', name: 'Result' }],
                controls: [{ id: 'factor', type: 'number' }],
                controlValues: { factor: 3 },
            });

            graph.addNode('node1', node1);
            graph.addNode('node2', node2);

            // Create cycle: node1 → node2 → node1
            graph.addConnection({ fromNode: 'node1', fromIndex: 0, toNode: 'node2', toIndex: 0 });
            graph.addConnection({ fromNode: 'node2', fromIndex: 0, toNode: 'node1', toIndex: 0 });

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            await assert.rejects(
                () =>
                    transpiler.transpile(collection, {
                        deviceRuntime: workspace.deviceRuntime,
                    }),
                /cycle/i,
                'Should reject with cycle error'
            );

            const errorEvents = progressEvents.filter((e) => e.type === ProgressEventType.ERROR);
            assert.equal(errorEvents.length, 1, 'Should emit ERROR event');
        });
    });

    describe('Cache Management', () => {
        it('should cache generated code', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'TestGraph');
            const node = new MockNodeData({
                id: 'node1',
                type: 'const',
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [{ id: 'value', type: 'number' }],
                controlValues: { value: 42 },
            });
            graph.addNode('node1', node);
            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            const cachedCode = transpiler.getLastGeneratedCode();
            const cachedAssets = transpiler.getLastGeneratedAssets();

            assert.ok(cachedCode, 'Should cache generated code');
            assert.ok(cachedAssets, 'Should cache assets');
        });

        it('should detect when transpilation is needed', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'TestGraph');
            const node = new MockNodeData({
                id: 'node1',
                type: 'const',
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [{ id: 'value', type: 'number' }],
                controlValues: { value: 42 },
            });
            graph.addNode('node1', node);
            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            assert.ok(transpiler.needsTranspile(collection), 'Should need transpile initially');

            await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(
                !transpiler.needsTranspile(collection),
                'Should not need transpile after transpiling'
            );

            // Change minor version
            collection.setVersion('1.1.0');

            assert.ok(
                transpiler.needsTranspile(collection),
                'Should need transpile after version change'
            );
        });

        it('should clear cache', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'TestGraph');
            const node = new MockNodeData({
                id: 'node1',
                type: 'const',
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [{ id: 'value', type: 'number' }],
                controlValues: { value: 42 },
            });
            graph.addNode('node1', node);
            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(transpiler.getLastGeneratedCode(), 'Should have cached code');

            transpiler.clearCache();

            assert.equal(transpiler.getLastGeneratedCode(), null, 'Should clear cached code');
            assert.ok(
                transpiler.needsTranspile(collection),
                'Should need transpile after clearing cache'
            );
        });
    });

    describe('Asset Registration', () => {
        it('should collect assets from nodes', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'AssetGraph');

            const customNode = new MockNodeData({
                id: 'node1',
                type: 'custom',
                inputs: [{ id: 'in0', name: 'Value' }],
                outputs: [{ id: 'out0', name: 'Result' }],
            });
            graph.addNode('node1', customNode);

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            assert.ok(result.assets, 'Should return assets');
            assert.ok(result.assets.packages, 'Should have packages object');
            assert.ok(result.assets.packages.core, 'Should have core package assets');
            assert.ok(result.assets.packages.core.files.length > 0, 'Should collect asset files');
        });
    });

    describe('Error Handling', () => {
        it('should throw error for non-existent collection', async () => {
            await assert.rejects(
                () =>
                    transpiler.transpile(null, {
                        deviceRuntime: workspace.deviceRuntime,
                    }),
                /No collection provided/i,
                'Should throw collection missing error'
            );
        });

        it('should throw error for missing node definition', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'BadGraph');

            const unknownNode = new MockNodeData({
                id: 'node1',
                type: 'unknown-type',
                outputs: [{ id: 'out0', name: 'Value' }],
            });
            graph.addNode('node1', unknownNode);

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            await assert.rejects(
                () =>
                    transpiler.transpile(collection, {
                        deviceRuntime: workspace.deviceRuntime,
                    }),
                /Missing node definition for type/i,
                'Should throw missing definition error'
            );
        });

        it('should throw error for missing implementation', async () => {
            workspace.deviceRuntime.addNodeDefinition('no-impl', {
                title: 'No Implementation',
                outputs: [{ id: 'out0', name: 'Value' }],
                implementations: {},
            });

            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'NoImplGraph');

            const node = new MockNodeData({
                id: 'node1',
                type: 'no-impl',
                outputs: [{ id: 'out0', name: 'Value' }],
            });
            graph.addNode('node1', node);

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            await assert.rejects(
                () =>
                    transpiler.transpile(collection, {
                        deviceRuntime: workspace.deviceRuntime,
                    }),
                /lacks a python implementation/i,
                'Should throw missing implementation error'
            );
        });
    });

    describe('Code Structure', () => {
        it('should generate valid Python structure', async () => {
            const collection = new MockCollection('test-col', '1.0.0');
            const graph = new MockNodeGraph('graph1', 'StructureGraph');

            const node = new MockNodeData({
                id: 'node1',
                type: 'const',
                outputs: [{ id: 'out0', name: 'Value' }],
                controls: [{ id: 'value', type: 'number' }],
                controlValues: { value: 42 },
            });
            graph.addNode('node1', node);

            collection.addGraph('graph1', graph);
            workspace.addCollection('test-col', collection);

            const result = await transpiler.transpile(collection, {
                deviceRuntime: workspace.deviceRuntime,
            });

            // Check structure
            const lines = result.code.split('\n');
            const graphDefIndex = lines.findIndex(
                (line) => line.includes('async def ') && !line.includes('async def run')
            );
            const whileIndex = lines.findIndex((line) => line.trim() === 'while True:');
            const runDefIndex = lines.findIndex((line) => line.includes('async def run():'));

            assert.ok(graphDefIndex >= 0, 'Should have async def for graph function');
            assert.ok(
                whileIndex > graphDefIndex,
                'Should have while loop after graph function def'
            );
            assert.ok(runDefIndex > whileIndex, 'Should have async def run() entry point at end');
        });
    });
});
