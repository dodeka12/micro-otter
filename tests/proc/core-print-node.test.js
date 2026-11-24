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
        this.inputDefaults = { ...inputDefaults };
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

function loadCoreDefinitions() {
    return JSON.parse(readFileSync(coreDefsPath, 'utf8')).nodeTypes;
}

/**
 * Build a runtime with the real core node definitions plus a minimal bool source,
 * so the guarded print can be fed by a connector without leaning on the const node.
 */
function buildRuntime() {
    const runtime = new MockRuntime();
    for (const [type, definition] of Object.entries(loadCoreDefinitions())) {
        runtime.addNodeDefinition(type, {
            ...definition,
            packageId: 'core',
            mpAssets: [],
            mpModuleRoots: [''],
        });
    }

    runtime.addNodeDefinition('bool-source', {
        title: 'Bool Source',
        inputs: [],
        outputs: [{ id: 'out0', outputType: 'bool' }],
        controls: [],
        implementations: {
            python: {
                type: 'regex',
                value: 'True',
            },
        },
    });

    return runtime;
}

function buildNode(type, id, runtime, { controlValues = {}, inputDefaults = {} } = {}) {
    const definition = runtime.getNodeType(type);
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

async function transpileGraph(runtime, graph) {
    const collection = new MockCollection('prints');
    collection.addGraph('g', graph);
    const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
    return transpiler.transpile(collection, { deviceRuntime: runtime });
}

function compactCode(code) {
    return code.replace(/\s+/g, ' ');
}

describe('core print node', () => {
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

        await import(`${pathToFileURL(coreGeneratorsPath).href}?test=core-print-node`);
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

    it('defines an enabled boolean input that defaults to true', () => {
        const printDefinition = loadCoreDefinitions().print;
        assert.ok(printDefinition, 'Missing print node definition');

        const inputs = printDefinition.inputs || [];
        assert.deepEqual(
            inputs.map((input) => input.id),
            ['enabled', 'title', 'in0']
        );

        const enabledInput = inputs[0];
        assert.deepEqual(enabledInput.allowedTypes, ['bool']);
        assert.deepEqual(enabledInput.initialTypes, ['bool']);
        assert.equal(enabledInput.defaultControl?.type, 'checkbox');
        assert.equal(enabledInput.defaultControl?.default, true);
        assert.equal(
            printDefinition.implementations?.python?.value,
            'NodeCodeGenerators.printNode'
        );
        assert.equal(printDefinition.implementations?.python?.type, 'code-generator');
    });

    it('generator guards the print statement with the enabled input', () => {
        const generator = globalThis.NodeCodeGenerators.printNode;
        assert.equal(typeof generator, 'function');

        const result = generator({
            node: { id: '1', type: 'print' },
            inputs: ['node_2_out0', "'Value'", 'node_1_out0'],
        });

        assert.equal(
            result.statement,
            "if bool(node_2_out0):\n    print('[user] ', 'Value', ': ', node_1_out0)"
        );
        assert.deepEqual(result.outputs, []);
    });

    it('generator falls back to True and None when inputs are missing', () => {
        const result = globalThis.NodeCodeGenerators.printNode({
            node: { id: '1', type: 'print' },
            inputs: [],
        });

        assert.equal(result.statement, "if bool(True):\n    print('[user] ', '', ': ', None)");
    });

    it('transpiles a print guarded by the default enabled value', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('g', 'PrintDefaultGraph');
        graph.addNode('1', buildNode('bool-source', '1', runtime));
        graph.addNode('2', buildNode('print', '2', runtime));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 2 });

        const result = await transpileGraph(runtime, graph);

        assert.ok(
            compactCode(result.code).includes(
                "if bool(True): print('[user] ', 'Value', ': ', node_1_out0)"
            ),
            'Print should be guarded by the default enabled value'
        );
    });

    it('transpiles a connected enabled input into the guard', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('g', 'PrintConnectedGraph');
        graph.addNode('1', buildNode('bool-source', '1', runtime));
        graph.addNode('2', buildNode('print', '2', runtime));
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });

        const result = await transpileGraph(runtime, graph);

        assert.ok(
            compactCode(result.code).includes(
                "if bool(node_1_out0): print('[user] ', 'Value', ': ', None)"
            ),
            'Print should be guarded by the connected enabled expression'
        );
    });

    it('transpiles enabled=false input defaults into the guard', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('g', 'PrintDisabledGraph');
        graph.addNode(
            '1',
            buildNode('print', '1', runtime, { inputDefaults: { in0: 7, enabled: false } })
        );

        const result = await transpileGraph(runtime, graph);

        assert.ok(
            compactCode(result.code).includes("if bool(False): print('[user] ', 'Value', ': ', 7)"),
            'Print should be guarded by the stored enabled input default'
        );
    });
});
