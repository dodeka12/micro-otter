import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

const varsDefsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/vars/node_definitions.json'
);
const varsManifestPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/vars/manifest.json');
const varsGeneratorsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/vars/node_generators.js'
);

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
    getTriggerInterval() {
        return 100;
    }
    getNodes() {
        const result = {};
        this.nodes.forEach((node, nodeId) => {
            result[nodeId] = node;
        });
        return result;
    }
    addNode(nodeId, node) {
        this.nodes.set(nodeId, node);
    }
    getConnections() {
        return this.connections.slice();
    }
    addConnection(connection) {
        this.connections.push({ ...connection });
    }
}

class MockCollection {
    constructor(id) {
        this.id = id;
        this.graphs = new Map();
    }
    getId() {
        return this.id;
    }
    getVersion() {
        return '1.0.0';
    }
    getVersionString() {
        return '1.0.0';
    }
    getTitle() {
        return this.id;
    }
    getGraphs() {
        const result = {};
        this.graphs.forEach((graph, graphId) => {
            result[graphId] = graph;
        });
        return result;
    }
    addGraph(graphId, graph) {
        this.graphs.set(graphId, graph);
    }
}

class MockRuntime {
    constructor() {
        this.definitions = new Map();
    }
    addNodeDefinition(type, definition) {
        this.definitions.set(type, definition);
    }
    getNodeType(type) {
        return this.definitions.get(type) || null;
    }
}

function loadJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

function resolveMpAssets(manifest, nodeType) {
    const wildcard = Array.isArray(manifest.mpAssets?.['*']) ? manifest.mpAssets['*'] : [];
    const specific = Array.isArray(manifest.mpAssets?.[nodeType])
        ? manifest.mpAssets[nodeType]
        : [];
    return [...wildcard, ...specific];
}

function buildRuntime() {
    const runtime = new MockRuntime();
    const defs = loadJson(varsDefsPath).nodeTypes;
    const manifest = loadJson(varsManifestPath);
    for (const [type, def] of Object.entries(defs)) {
        runtime.addNodeDefinition(type, {
            ...def,
            packageId: 'vars',
            mpAssets: resolveMpAssets(manifest, type),
            mpModuleRoots: manifest.mpModuleRoots || [''],
        });
    }
    return runtime;
}

function buildNode(type, id, runtime, controlValues = {}, inputDefaults = {}) {
    const def = runtime.getNodeType(type);
    const inputs = (def.inputs || []).map((input) => ({ ...input }));
    const outputs = (def.outputs || []).map((output) => ({ ...output }));
    const controls = (def.controls || []).map((control) => ({ ...control }));
    return new MockNodeData({ id, type, inputs, outputs, controls, controlValues, inputDefaults });
}

async function transpileArrayMathChain(controlValues) {
    const runtime = buildRuntime();
    const graph = new MockNodeGraph('vars', 'Vars');
    graph.addNode('1', buildNode('array-generate', '1', runtime, {}, { count: 4 }));
    graph.addNode('2', buildNode('array-math', '2', runtime, controlValues));
    graph.addNode('3', buildNode('var-write', '3', runtime, { name: 'buf' }));
    graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
    graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 2 });

    const collection = new MockCollection('vars');
    collection.addGraph('vars', graph);

    const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
    const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
    return result.code.replace(/\s+/g, ' ');
}

async function transpileArraySetChain(controlValues, inputDefaults = {}, extraArrayWires = []) {
    const runtime = buildRuntime();
    const graph = new MockNodeGraph('vars', 'Vars');
    graph.addNode('1', buildNode('array-generate', '1', runtime, {}, { count: 4 }));
    graph.addNode('2', buildNode('array-set', '2', runtime, controlValues, inputDefaults));
    graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });

    let nextId = 2;
    for (const [toIndex, count] of extraArrayWires) {
        nextId += 1;
        const sourceId = String(nextId);
        graph.addNode(sourceId, buildNode('array-generate', sourceId, runtime, {}, { count }));
        graph.addConnection({ fromNode: sourceId, fromIndex: 0, toNode: '2', toIndex });
    }
    nextId += 1;
    const writeId = String(nextId);
    graph.addNode(writeId, buildNode('var-write', writeId, runtime, { name: 'buf' }));
    graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: writeId, toIndex: 2 });

    const collection = new MockCollection('vars');
    collection.addGraph('vars', graph);

    const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
    const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
    return result.code.replace(/\s+/g, ' ');
}

describe('vars transpiler integration', () => {
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
        await import(`${pathToFileURL(varsGeneratorsPath).href}?test=vars-integration`);
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

    it('transpiles a read/write store round-trip', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode('1', buildNode('var-write', '1', runtime, { name: 'buf' }));
        graph.addNode('2', buildNode('var-read', '2', runtime, { name: 'buf' }));

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /_store\.set\('default', 'buf', 0\)/);
        assert.match(normalized, /node_2_out0 = _store\.get\('default', 'buf', 0\)/);
        assert.ok(result.code.includes('import otter_vars.store as _store'));
    });
    it('transpiles a read/write round-trip with a custom store input default', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode(
            '1',
            buildNode('var-write', '1', runtime, { name: 'buf' }, { value: 0, store: 'presets' })
        );
        graph.addNode(
            '2',
            buildNode('var-read', '2', runtime, { name: 'buf' }, { value: 0, store: 'presets' })
        );

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /_store\.set\('presets', 'buf', 0\)/);
        assert.match(normalized, /node_2_out0 = _store\.get\('presets', 'buf', 0\)/);
    });

    it('transpiles a read/write round-trip with both picker sentinels', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        const sentinelControls = { name: '__new__', customName: 'temp', customStore: 'presets' };
        const sentinelInputs = { value: 0, store: '__new__' };
        graph.addNode('1', buildNode('var-write', '1', runtime, sentinelControls, sentinelInputs));
        graph.addNode('2', buildNode('var-read', '2', runtime, sentinelControls, sentinelInputs));

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /_store\.set\('presets', 'temp', 0\)/);
        assert.match(normalized, /node_2_out0 = _store\.get\('presets', 'temp', 0\)/);
        assert.doesNotMatch(normalized, /__new__/);
    });

    it('transpiles a new-store sentinel without companion text as the default namespace', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode(
            '1',
            buildNode('var-write', '1', runtime, { name: 'x' }, { value: 0, store: '__new__' })
        );

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /_store\.set\('default', 'x', 0\)/);
        assert.doesNotMatch(normalized, /__new__/);
    });

    it('keeps a wired store input ahead of the input default', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode(
            '1',
            buildNode('var-read', '1', runtime, { name: 'buf' }, { value: 0, store: 'presets' })
        );
        graph.addNode(
            '2',
            buildNode('var-read', '2', runtime, { name: 'buf' }, { value: 0, store: 'logs' })
        );
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /node_2_out0 = _store\.get\(node_1_out0, 'buf', 0\)/);
    });

    it('transpiles an array-generate to var-write chain', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode('1', buildNode('array-generate', '1', runtime, {}, { count: 4 }));
        graph.addNode(
            '2',
            buildNode('array-math', '2', runtime, { operation: 'add', clamp: false })
        );
        graph.addNode(
            '3',
            buildNode('array-modify', '3', runtime, {
                wrap: true,
                clamp: false,
            })
        );
        graph.addNode('4', buildNode('var-write', '4', runtime, { name: 'buf' }));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 0 });
        graph.addConnection({ fromNode: '3', fromIndex: 0, toNode: '4', toIndex: 2 });

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(result.code, /# Initialization[\s\S]*node_1_out0 = None[\s\S]*while True:/);
        assert.match(normalized, /node_1_out0 = _arr\.generate\(node_1_out0, 4\)/);
        assert.match(normalized, /node_2_out0 = _arr\.add\(node_1_out0, 0, clamp=False\)/);
        assert.match(
            normalized,
            /node_3_out0 = _arr\.shift\(node_2_out0, 0, wrap=True, clamp=False, inplace=False\)/
        );
        assert.match(normalized, /_store\.set\('default', 'buf', node_3_out0\)/);
        assert.ok(result.code.includes('import otter_vars.arrays as _arr'));
    });

    it('transpiles a concat array-modify chain', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode('1', buildNode('array-generate', '1', runtime, {}, { count: 4 }));
        graph.addNode('2', buildNode('array-generate', '2', runtime, {}, { count: 3 }));
        graph.addNode(
            '3',
            buildNode('array-modify', '3', runtime, { modifyType: 'concat', clamp: false })
        );
        graph.addNode('4', buildNode('var-write', '4', runtime, { name: 'buf' }));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '3', toIndex: 0 });
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 2 });
        graph.addConnection({ fromNode: '3', fromIndex: 0, toNode: '4', toIndex: 2 });

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /node_3_out0 = _arr\.concat\(node_1_out0, node_2_out0, clamp=False\)/);
        assert.match(normalized, /_store\.set\('default', 'buf', node_3_out0\)/);
    });

    it('transpiles repeat with the definition default count', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode('1', buildNode('array-generate', '1', runtime, {}, { count: 4 }));
        graph.addNode(
            '2',
            buildNode('array-modify', '2', runtime, { modifyType: 'repeat', clamp: false })
        );
        graph.addNode('3', buildNode('var-write', '3', runtime, { name: 'buf' }));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 2 });

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /node_2_out0 = _arr\.repeat\(node_1_out0, 1, clamp=False\)/);
    });

    it('transpiles interlace with an unwired second array', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode('1', buildNode('array-generate', '1', runtime, {}, { count: 4 }));
        graph.addNode(
            '2',
            buildNode('array-modify', '2', runtime, { modifyType: 'interlace', clamp: false })
        );
        graph.addNode('3', buildNode('var-write', '3', runtime, { name: 'buf' }));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 2 });

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(
            normalized,
            /node_2_out0 = _arr\.interlace\(node_1_out0, None, 2, 0, clamp=False\)/
        );
    });

    it('transpiles a random-uniform array-set', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode('1', buildNode('array-generate', '1', runtime, {}, { count: 4 }));
        graph.addNode(
            '2',
            buildNode('array-set', '2', runtime, { setType: 'randomUniform', clamp: false })
        );
        graph.addNode('3', buildNode('var-write', '3', runtime, { name: 'buf' }));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 2 });

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(
            normalized,
            /node_2_out0 = _arr\.random_uniform\(node_1_out0, 0, 1, clamp=False, inplace=False\)/
        );
    });

    it('transpiles a random-normal array-set', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode('1', buildNode('array-generate', '1', runtime, {}, { count: 4 }));
        graph.addNode(
            '2',
            buildNode('array-set', '2', runtime, { setType: 'randomNormal', clamp: false })
        );
        graph.addNode('3', buildNode('var-write', '3', runtime, { name: 'buf' }));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 2 });

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(
            normalized,
            /node_2_out0 = _arr\.random_normal\(node_1_out0, 0\.5, 0\.15, 0, 1, clamp=False, inplace=False\)/
        );
    });

    it('transpiles an array-set that writes in place', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode('1', buildNode('array-generate', '1', runtime, {}, { count: 4 }));
        graph.addNode(
            '2',
            buildNode('array-set', '2', runtime, {
                setType: 'fill',
                clamp: false,
                inplace: true,
            })
        );
        graph.addNode('3', buildNode('var-write', '3', runtime, { name: 'buf' }));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 2 });

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(
            normalized,
            /node_2_out0 = _arr\.fill\(node_1_out0, 0, 0, -1, clamp=False, inplace=True\)/
        );
    });

    it('transpiles an array-set scalar set', async () => {
        const normalized = await transpileArraySetChain(
            { setType: 'set', indexMode: 'clamp', clamp: false },
            { index: 2, value: 0.75 }
        );
        assert.match(
            normalized,
            /node_2_out0 = _arr\.set\(node_1_out0, 2, 0\.75, mode='clamp', clamp=False, inplace=False\)/
        );
    });

    it('transpiles an array-set sub-array set that wraps', async () => {
        const normalized = await transpileArraySetChain(
            { setType: 'set', indexMode: 'wrap', clamp: false },
            { index: 1 },
            [[2, 2]]
        );
        assert.match(
            normalized,
            /node_2_out0 = _arr\.set\(node_1_out0, 1, node_3_out0, mode='wrap', clamp=False, inplace=False\)/
        );
    });

    it('transpiles an array-set shift with the default fill value', async () => {
        const normalized = await transpileArraySetChain(
            { setType: 'set', indexMode: 'shift', clamp: false },
            { index: 2, value: 0.75 }
        );
        assert.match(
            normalized,
            /node_2_out0 = _arr\.set\(node_1_out0, 2, 0\.75, mode='shift', fill=0, clamp=False, inplace=False\)/
        );
    });

    it('transpiles an array-set setIndices', async () => {
        const normalized = await transpileArraySetChain(
            { setType: 'setIndices', indexMode: 'clamp', clamp: false },
            { value: 0.5 },
            [[3, 2]]
        );
        assert.match(
            normalized,
            /node_2_out0 = _arr\.set_indices\(node_1_out0, node_3_out0, 0\.5, mode='clamp', clamp=False, inplace=False\)/
        );
    });

    it('transpiles an array-set fill with start and width', async () => {
        const normalized = await transpileArraySetChain(
            { setType: 'fill', clamp: false },
            { value: 0.5, start: 2, width: 3 }
        );
        assert.match(
            normalized,
            /node_2_out0 = _arr\.fill\(node_1_out0, 0\.5, 2, 3, clamp=False, inplace=False\)/
        );
    });

    it('transpiles an array-set ramp with start, width, min and max', async () => {
        const normalized = await transpileArraySetChain(
            { setType: 'ramp', clamp: false },
            { start: 0, width: -1, min: -1, max: 2 }
        );
        assert.match(
            normalized,
            /node_2_out0 = _arr\.ramp\(node_1_out0, 0, -1, -1, 2, clamp=False, inplace=False\)/
        );
    });

    it('transpiles an array-set hat with start and width', async () => {
        const normalized = await transpileArraySetChain(
            { setType: 'hat', clamp: false },
            { start: 1, width: 4, min: 0, max: 1 }
        );
        assert.match(
            normalized,
            /node_2_out0 = _arr\.hat\(node_1_out0, 1, 4, 0, 1, clamp=False, inplace=False\)/
        );
    });

    it('transpiles an array-set steps', async () => {
        const normalized = await transpileArraySetChain(
            { setType: 'steps', clamp: false },
            { start: 1, stepWidth: 2, numSteps: 3, min: 0, max: 1 }
        );
        assert.match(
            normalized,
            /node_2_out0 = _arr\.steps\(node_1_out0, 1, 2, 3, 0, 1, clamp=False, inplace=False\)/
        );
    });

    it('transpiles array-set square and sawtooth waves', async () => {
        for (const [setType, runtimeOp] of [
            ['square', 'square_wave'],
            ['sawtooth', 'sawtooth_wave'],
        ]) {
            const normalized = await transpileArraySetChain(
                { setType, clamp: false },
                { start: 0, period: 8, periodCount: 2, phase: 0, amplitude: 0.5, offset: 0.5 }
            );
            assert.match(
                normalized,
                new RegExp(
                    `node_2_out0 = _arr\\.${runtimeOp}\\(node_1_out0, 0, 8, 2, 0, 0\\.5, 0\\.5, clamp=False, inplace=False\\)`
                )
            );
        }
    });

    it('transpiles a random-value node into the loop', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode('1', buildNode('random-value', '1', runtime));

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(
            normalized,
            /while True:.*node_1_out0 = _arr\.random_uniform_value\(0, 1, integer=False\)/
        );
        assert.ok(result.code.includes('import otter_vars.arrays as _arr'));
    });

    it('transpiles a random-value node with a normal int output', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode(
            '2',
            buildNode('random-value', '2', runtime, {
                distribution: 'normal',
                valueType: 'int',
            })
        );

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(
            normalized,
            /node_2_out0 = _arr\.random_normal_value\(0\.5, 0\.15, 0, 1, integer=True\)/
        );
        assert.ok(result.code.includes('import otter_vars.arrays as _arr'));
    });

    it('feeds a random-value node into var-write', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode('1', buildNode('random-value', '1', runtime));
        graph.addNode('2', buildNode('var-write', '2', runtime, { name: 'value' }));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 2 });

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /_store\.set\('default', 'value', node_1_out0\)/);
        assert.match(normalized, /node_1_out0 = _arr\.random_uniform_value\(0, 1, integer=False\)/);
        assert.ok(result.code.includes('import otter_vars.arrays as _arr'));
    });

    it('transpiles a random-seed node before the random draw', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode('1', buildNode('random-seed', '1', runtime));
        graph.addNode('2', buildNode('random-value', '2', runtime));
        graph.addNode('3', buildNode('var-write', '3', runtime, { name: 'value' }));
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 2 });

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        const reseedIndex = normalized.indexOf("_arr.reseed(True, 0, key='seed:vars:1')");
        const drawIndex = normalized.indexOf(
            'node_2_out0 = _arr.random_uniform_value(0, 1, integer=False)'
        );
        assert.ok(reseedIndex >= 0, normalized);
        assert.ok(drawIndex > reseedIndex, normalized);
        assert.match(normalized, /_store\.set\('default', 'value', node_2_out0\)/);
        assert.ok(result.code.includes('import otter_vars.arrays as _arr'));
    });

    it('transpiles a disabled random-seed with a seed value', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode(
            '1',
            buildNode('random-seed', '1', runtime, {}, { enabled: false, seed: 42 })
        );
        graph.addNode('2', buildNode('random-value', '2', runtime));
        graph.addNode('3', buildNode('var-write', '3', runtime, { name: 'value' }));
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 2 });

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /_arr\.reseed\(False, 42, key='seed:vars:1'\)/);
        assert.ok(result.code.includes('import otter_vars.arrays as _arr'));
    });

    it('transpiles an array-math sqrt operation', async () => {
        const normalized = await transpileArrayMathChain({ operation: 'sqrt', clamp: false });
        assert.match(normalized, /node_2_out0 = _arr\.sqrt\(node_1_out0, clamp=False\)/);
    });

    it('transpiles an array-math sin operation with radians', async () => {
        const normalized = await transpileArrayMathChain({
            operation: 'sin',
            angleUnit: 'radians',
            clamp: false,
        });
        assert.match(
            normalized,
            /node_2_out0 = _arr\.sin\(node_1_out0, angle_unit='radians', clamp=False\)/
        );
    });

    it('transpiles an array-math atan operation with the angle unit', async () => {
        const normalized = await transpileArrayMathChain({
            operation: 'atan',
            angleUnit: 'radians',
            clamp: false,
        });
        assert.match(
            normalized,
            /node_2_out0 = _arr\.atan\(node_1_out0, angle_unit='radians', clamp=False\)/
        );
    });

    it('transpiles an array-math atan2 operation with percent and clamp', async () => {
        const normalized = await transpileArrayMathChain({
            operation: 'atan2',
            angleUnit: 'percent',
            clamp: true,
        });
        assert.match(
            normalized,
            /node_2_out0 = _arr\.atan2\(node_1_out0, 0, angle_unit='percent', clamp=True\)/
        );
    });

    it('transpiles an array-math length reduction', async () => {
        const normalized = await transpileArrayMathChain({ operation: 'length' });
        assert.match(normalized, /node_2_out0 = _arr\.length\(node_1_out0\)/);
    });

    it('transpiles an array-math max reduction with percent', async () => {
        const normalized = await transpileArrayMathChain({
            operation: 'max',
            percent: 25,
            clamp: false,
        });
        assert.match(
            normalized,
            /node_2_out0 = _arr\.mo_max\(node_1_out0, percent=25, clamp=False\)/
        );
    });

    it('transpiles an array-math modulus operation', async () => {
        const normalized = await transpileArrayMathChain({ operation: 'modulus', clamp: false });
        assert.match(normalized, /node_2_out0 = _arr\.mod\(node_1_out0, 0, clamp=False\)/);
    });

    it('transpiles the array-math power operation', async () => {
        const normalized = await transpileArrayMathChain({ operation: 'power', clamp: false });
        assert.match(normalized, /node_2_out0 = _arr\.power\(node_1_out0, 0, clamp=False\)/);
    });

    it('transpiles the array-math root operation', async () => {
        const normalized = await transpileArrayMathChain({ operation: 'root', clamp: false });
        assert.match(normalized, /node_2_out0 = _arr\.root\(node_1_out0, 0, clamp=False\)/);
    });

    it('transpiles the array-math hyperbolic operations', async () => {
        for (const operation of ['sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh']) {
            const normalized = await transpileArrayMathChain({ operation, clamp: false });
            assert.match(
                normalized,
                new RegExp(`node_2_out0 = _arr\\.${operation}\\(node_1_out0, clamp=False\\)`),
                `unexpected code for ${operation}: ${normalized}`
            );
        }
    });

    it('transpiles the array-math natural logarithm operation', async () => {
        const normalized = await transpileArrayMathChain({ operation: 'ln', clamp: false });
        assert.match(normalized, /node_2_out0 = _arr\.ln\(node_1_out0, clamp=False\)/);
    });

    it('transpiles the array-math logarithm to a base operation', async () => {
        const normalized = await transpileArrayMathChain({ operation: 'log', clamp: false });
        assert.match(normalized, /node_2_out0 = _arr\.log\(node_1_out0, 0, clamp=False\)/);
    });

    it('transpiles the array-math floor and ceil operations', async () => {
        const floorCode = await transpileArrayMathChain({ operation: 'floor', clamp: false });
        assert.match(floorCode, /node_2_out0 = _arr\.floor\(node_1_out0, clamp=False\)/);

        const ceilCode = await transpileArrayMathChain({ operation: 'ceil', clamp: false });
        assert.match(ceilCode, /node_2_out0 = _arr\.ceil\(node_1_out0, clamp=False\)/);
    });

    it('transpiles the array-math round operation with decimal places', async () => {
        const withDecimals = await transpileArrayMathChain({
            operation: 'round',
            decimalPlaces: 2,
            clamp: false,
        });
        assert.match(
            withDecimals,
            /node_2_out0 = _arr\.round\(node_1_out0, decimals=2, clamp=False\)/
        );

        const withoutControl = await transpileArrayMathChain({ operation: 'round', clamp: false });
        assert.match(
            withoutControl,
            /node_2_out0 = _arr\.round\(node_1_out0, decimals=0, clamp=False\)/
        );
    });

    it('transpiles an array-select that wraps the index', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode('1', buildNode('array-generate', '1', runtime, {}, { count: 4 }));
        graph.addNode(
            '2',
            buildNode('array-select', '2', runtime, { indexMode: 'wrap' }, { index: 3 })
        );
        graph.addNode('3', buildNode('var-write', '3', runtime, { name: 'value' }));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 2 });

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /node_1_out0 = _arr\.generate\(node_1_out0, 4\)/);
        assert.match(normalized, /node_2_out0 = _arr\.select\(node_1_out0, 3, 0, mode='wrap'\)/);
        assert.match(normalized, /_store\.set\('default', 'value', node_2_out0\)/);
        assert.ok(result.code.includes('import otter_vars.arrays as _arr'));
        assert.equal(result.code.split('import otter_vars.arrays as _arr').length - 1, 1);
    });

    it('transpiles var-store-save and var-store-load with edge triggers', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('vars', 'Vars');
        graph.addNode('1', buildNode('var-store-save', '1', runtime, {}));
        graph.addNode('2', buildNode('var-store-load', '2', runtime, {}));

        const collection = new MockCollection('vars');
        collection.addGraph('vars', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /_store\.edge_trigger\('save:vars:1', False\)/);
        assert.match(normalized, /_store\.save\('default'\)/);
        assert.match(normalized, /_store\.edge_trigger\('load:vars:2', False\)/);
        assert.match(normalized, /_store\.load\('default'\)/);
        assert.match(
            normalized,
            /if bool\(True\): if _store\.edge_trigger\('save:vars:1', False\): _store\.save\('default'\)/
        );
        assert.ok(
            !normalized.includes("if bool(True): if _store.edge_trigger('load:vars:2'"),
            'the load must stay ungated'
        );
        assert.ok(result.code.includes('import otter_vars.store as _store'));
    });
});
