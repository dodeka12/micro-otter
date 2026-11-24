import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

class MockNodeData {
    constructor({ id, type, inputs = [], outputs = [], controls = [], controlValues = {} }) {
        this.id = id;
        this.type = type;
        this.title = type;
        this.inputs = inputs;
        this.outputs = outputs;
        this.controls = controls;
        this.controlValues = controlValues;
        this.inputDefaults = {};
    }
    getId() { return this.id; }
    getType() { return this.type; }
}

class MockGraph {
    constructor(id, name, executionType) {
        this.id = id;
        this.name = name;
        this.executionType = executionType;
        this.nodes = new Map();
        this.connections = [];
    }
    getId() { return this.id; }
    getName() { return this.name; }
    getTriggerInterval() { return 100; }
    getExecutionType() { return this.executionType; }
    getNodes() { const r = {}; this.nodes.forEach((n, id) => { r[id] = n; }); return r; }
    addNode(id, node) { this.nodes.set(id, node); }
    getConnections() { return this.connections.slice(); }
}

class MockCollection {
    constructor() { this.graphs = new Map(); }
    getId() { return 'startup-collection'; }
    getVersion() { return '1.0.0'; }
    getVersionString() { return '1.0.0'; }
    getTitle() { return 'Startup'; }
    getGraphs() { const r = {}; this.graphs.forEach((g, id) => { r[id] = g; }); return r; }
    addGraph(id, graph) { this.graphs.set(id, graph); }
}

class MockRuntime {
    constructor() { this.defs = new Map(); }
    addNodeDefinition(type, def) { this.defs.set(type, def); }
    getNodeType(type) { return this.defs.get(type) || null; }
}

function buildRuntime() {
    const runtime = new MockRuntime();
    runtime.addNodeDefinition('emit', {
        title: 'Emit',
        inputs: [],
        outputs: [{ id: 'out0', name: 'Out', outputType: 'float' }],
        controls: [{ id: 'value', type: 'number', default: 1 }],
        implementations: { python: { type: 'regex', value: '{{value}}' } },
    });
    return runtime;
}

function buildNode(type, id, runtime, controlValues = {}) {
    const def = runtime.getNodeType(type);
    return new MockNodeData({
        id,
        type,
        inputs: (def.inputs || []).map((input) => ({ ...input })),
        outputs: (def.outputs || []).map((output) => ({ ...output })),
        controls: (def.controls || []).map((control) => ({ ...control })),
        controlValues,
    });
}

describe('startup graph transpiler', () => {
    it('runs startup graphs once before continuous graphs', async () => {
        const runtime = buildRuntime();
        const initGraph = new MockGraph('init', 'Init', 'startup');
        initGraph.addNode('1', buildNode('emit', '1', runtime, { value: 1 }));
        const mainGraph = new MockGraph('main', 'Main', 'continuous');
        mainGraph.addNode('2', buildNode('emit', '2', runtime, { value: 1 }));

        const collection = new MockCollection();
        collection.addGraph('init', initGraph);
        collection.addGraph('main', mainGraph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const code = result.code;

        assert.match(code, /async def init\(\):/);
        assert.match(code, /async def main\(\):/);
        assert.equal((code.match(/while True:/g) || []).length, 1);
        assert.ok(code.indexOf('await init()') < code.indexOf('await main()'));
    });
});
