import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

const coreDefsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/node_definitions.json'
);
const coreGeneratorsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/node_generators.js'
);
const coreMathGeneratorPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/generator_math_processor.js'
);

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

function buildRuntime() {
    const runtime = new MockRuntime();
    const defs = loadJson(coreDefsPath).nodeTypes;
    for (const [type, def] of Object.entries(defs)) {
        runtime.addNodeDefinition(type, {
            ...def,
            packageId: 'core',
            mpAssets: [],
            mpModuleRoots: [''],
        });
    }
    return runtime;
}

function buildNode(type, id, runtime, controlValues = {}) {
    const def = runtime.getNodeType(type);
    const inputs = (def.inputs || []).map((input) => ({ ...input }));
    const outputs = (def.outputs || []).map((output) => ({ ...output }));
    const controls = (def.controls || []).map((control) => ({ ...control }));
    return new MockNodeData({ id, type, inputs, outputs, controls, controlValues });
}

/**
 * Transpile a single math node feeding the core print node, so the generated loop body contains
 * the math statement and the print node keeps the result reachable.
 */
async function transpileMathOperation(operation, controlValues = {}) {
    const runtime = buildRuntime();
    const graph = new MockNodeGraph('g', 'MathGraph');
    graph.addNode('1', buildNode('math', '1', runtime, { operation, ...controlValues }));
    graph.addNode('2', buildNode('print', '2', runtime, {}));
    graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 2 });

    const collection = new MockCollection('math');
    collection.addGraph('g', graph);

    const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
    const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
    return result.code.replace(/\s+/g, ' ');
}

describe('core math node transpiler integration', () => {
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

        await import(`${pathToFileURL(coreGeneratorsPath).href}?test=core-math-transpiler`);
        await import(`${pathToFileURL(coreMathGeneratorPath).href}?test=core-math-transpiler`);
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

    it('emits floor with a single math import', async () => {
        const code = await transpileMathOperation('floor');

        assert.match(code, /node_1_out0 = math\.floor\(0\)/);
        assert.equal(code.split('import math').length - 1, 1);
    });

    it('emits ceil with a single math import', async () => {
        const code = await transpileMathOperation('ceil');

        assert.match(code, /node_1_out0 = math\.ceil\(0\)/);
        assert.equal(code.split('import math').length - 1, 1);
    });

    it('emits the builtin round when no decimal places are configured', async () => {
        const code = await transpileMathOperation('round');

        assert.match(code, /node_1_out0 = round\(0\)/);
        assert.equal(code.split('import math').length - 1, 1);
    });

    it('emits round with the configured decimal places', async () => {
        const code = await transpileMathOperation('round', { decimalPlaces: 3 });

        assert.match(code, /node_1_out0 = round\(0, 3\)/);
        assert.equal(code.split('import math').length - 1, 1);
    });

    it('emits power with a single math import', async () => {
        const code = await transpileMathOperation('power');

        assert.match(code, /node_1_out0 = math\.pow\(0, 0\)/);
        assert.equal(code.split('import math').length - 1, 1);
    });

    it('emits nth root with a single math import', async () => {
        const code = await transpileMathOperation('root');

        assert.match(code, /node_1_out0 = math\.pow\(0, 1\.0 \/ \(0\)\)/);
        assert.equal(code.split('import math').length - 1, 1);
    });

    it('emits the natural logarithm with a single math import', async () => {
        const code = await transpileMathOperation('ln');

        assert.match(code, /node_1_out0 = math\.log\(0\)/);
        assert.equal(code.split('import math').length - 1, 1);
    });

    it('emits the logarithm to a base with a single math import', async () => {
        const code = await transpileMathOperation('log');

        assert.match(code, /node_1_out0 = math\.log\(0, 0\)/);
        assert.equal(code.split('import math').length - 1, 1);
    });

    it('emits unary atan converted to the selected angle unit', async () => {
        const degrees = await transpileMathOperation('atan');

        assert.match(degrees, /node_1_out0 = \(math\.atan\(0\)\) \* \(180 \/ math\.pi\)/);
        assert.equal(degrees.split('import math').length - 1, 1);

        const radians = await transpileMathOperation('atan', { angleUnit: 'radians' });

        assert.match(radians, /node_1_out0 = math\.atan\(0\)/);
        assert.equal(radians.split('import math').length - 1, 1);
    });

    it('emits the hyperbolic operations with a single math import', async () => {
        for (const operation of ['sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh']) {
            const code = await transpileMathOperation(operation);

            assert.match(
                code,
                new RegExp(`node_1_out0 = math\\.${operation}\\(0\\)`),
                `unexpected code for ${operation}: ${code}`
            );
            assert.equal(code.split('import math').length - 1, 1, `${operation} import count`);
        }
    });

    it('imports math once when floor and ceil share a graph', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('g', 'MathGraph');
        graph.addNode('1', buildNode('math', '1', runtime, { operation: 'floor' }));
        graph.addNode('2', buildNode('math', '2', runtime, { operation: 'ceil' }));
        graph.addNode('3', buildNode('print', '3', runtime, {}));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 2 });

        const collection = new MockCollection('math');
        collection.addGraph('g', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const code = result.code.replace(/\s+/g, ' ');

        assert.match(code, /node_1_out0 = math\.floor\(0\)/);
        assert.match(code, /node_2_out0 = math\.ceil\(node_1_out0\)/);
        assert.equal(code.split('import math').length - 1, 1);
    });
});
