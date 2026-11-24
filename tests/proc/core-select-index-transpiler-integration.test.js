import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { resolveUnionOutputType } from '../../src/micro_otter/nodes/html/js/data/type-conversions.js';

const coreRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/core');
const coreDefinitionsPath = path.join(coreRoot, 'node_definitions.json');
const coreGeneratorsPath = path.join(coreRoot, 'node_generators.js');

/**
 * Minimal typed sources so select-index receives real connector types without
 * leaning on a control-driven const node.
 */
const SOURCE_NODES = {
    'int-source': { outputType: 'int', value: '1' },
    'float-source': { outputType: 'float', value: '1.5' },
    'string-source': { outputType: 'string', value: "'abc'" },
    'bool-source': { outputType: 'bool', value: 'True' },
    'tuple-source': { outputType: 'core.tuple', value: '(1, 2,)' },
};

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
    constructor(id) {
        this.id = id;
        this.name = id;
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

/**
 * Load the shipped core node definitions.
 * @returns {Record<string, object>} Node definitions keyed by type id.
 */
function loadCoreDefinitions() {
    return JSON.parse(readFileSync(coreDefinitionsPath, 'utf8')).nodeTypes;
}

/**
 * Build a runtime with the real core definitions plus the typed test sources.
 * @returns {MockRuntime} Runtime serving definitions to the transpiler.
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

    for (const [type, source] of Object.entries(SOURCE_NODES)) {
        runtime.addNodeDefinition(type, {
            title: type,
            inputs: [],
            outputs: [{ id: 'out0', outputType: source.outputType }],
            controls: [],
            implementations: {
                python: {
                    type: 'regex',
                    value: source.value,
                },
            },
        });
    }

    return runtime;
}

/**
 * Build one node snapshot from its runtime definition.
 * @param {string} type - Node type id.
 * @param {string} id - Node instance id.
 * @param {MockRuntime} runtime - Runtime holding the definition.
 * @param {{controlValues?: object, inputDefaults?: object}} options - Stored defaults.
 * @returns {MockNodeData} Node snapshot for the transpiler.
 */
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

/**
 * Build a mock graph from node specs and connection specs.
 * @param {MockRuntime} runtime - Runtime holding the node definitions.
 * @param {{id?: string, nodes?: Array<object>, connections?: Array<object>}} spec - Graph content.
 * @returns {MockNodeGraph} Graph ready for transpilation.
 */
function createGraph(runtime, { id = 'mux-graph', nodes = [], connections = [] } = {}) {
    const graph = new MockNodeGraph(id);
    nodes.forEach(({ id: nodeId, type, controlValues, inputDefaults }) => {
        graph.addNode(nodeId, buildNode(type, nodeId, runtime, { controlValues, inputDefaults }));
    });
    connections.forEach((connection) => graph.addConnection(connection));
    return graph;
}

/**
 * Transpile one graph with the mock collection and runtime.
 * @param {MockRuntime} runtime - Runtime holding the node definitions.
 * @param {MockNodeGraph} graph - Graph to transpile.
 * @returns {Promise<{code: string}>} Transpiler result.
 */
async function transpileGraph(runtime, graph) {
    const collection = new MockCollection('mux-integration');
    collection.addGraph(graph.getId(), graph);
    const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
    return transpiler.transpile(collection, { deviceRuntime: runtime });
}

/**
 * Collapse all whitespace so generated statements can be asserted as one line.
 * @param {string} code - Generated Python code.
 * @returns {string} Single-line code.
 */
function compactCode(code) {
    return code.replace(/\s+/g, ' ');
}


describe('core select-index transpiler integration', () => {
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

        await import(`${pathToFileURL(coreGeneratorsPath).href}?test=core-select-index-transpiler`);
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

    it('emits the index guard and one branch per active value', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'idx', type: 'int-source' },
                { id: 'a', type: 'float-source' },
                { id: 'b', type: 'string-source' },
                { id: 'mux', type: 'select-index', controlValues: { count: 2 } },
                { id: 'show', type: 'print' },
            ],
            connections: [
                { fromNode: 'idx', fromIndex: 0, toNode: 'mux', toIndex: 0 },
                { fromNode: 'a', fromIndex: 0, toNode: 'mux', toIndex: 1 },
                { fromNode: 'b', fromIndex: 0, toNode: 'mux', toIndex: 2 },
                { fromNode: 'mux', fromIndex: 0, toNode: 'show', toIndex: 2 },
            ],
        });

        const result = await transpileGraph(runtime, graph);
        const flat = compactCode(result.code);

        assert.match(result.code, /async def run\(\):/);
        assert.ok(
            flat.includes('_select_raw_mux = node_idx_out0'),
            'select-index must read its index through a node-scoped temp'
        );
        assert.ok(
            flat.includes(
                '_select_index_mux = int(_select_raw_mux) if isinstance(_select_raw_mux, (int, float)) and -1 < _select_raw_mux < 2 else -1'
            ),
            'select-index must clamp fractions and reject an out-of-range index'
        );
        assert.ok(
            flat.includes('if _select_index_mux == 0: node_mux_out0 = node_a_out0'),
            'the zero branch must read value_1'
        );
        assert.ok(
            flat.includes('elif _select_index_mux == 1: node_mux_out0 = node_b_out0'),
            'the last active branch must read value_2'
        );
        assert.equal(flat.includes('_select_index_mux == 2'), false);
    });


    it('forwards the integer default for an unconnected active value', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'idx', type: 'int-source' },
                { id: 'a', type: 'float-source' },
                { id: 'mux', type: 'select-index', controlValues: { count: 2 } },
                { id: 'show', type: 'print' },
            ],
            connections: [
                { fromNode: 'idx', fromIndex: 0, toNode: 'mux', toIndex: 0 },
                { fromNode: 'a', fromIndex: 0, toNode: 'mux', toIndex: 1 },
                { fromNode: 'mux', fromIndex: 0, toNode: 'show', toIndex: 2 },
            ],
        });

        const result = await transpileGraph(runtime, graph);
        const flat = compactCode(result.code);

        assert.ok(
            flat.includes('elif _select_index_mux == 1: node_mux_out0 = 0'),
            "an unconnected value must generate its defaultControl default (0)"
        );
        assert.ok(flat.includes('node_mux_out0 = None'), 'the out-of-range fallback stays None');
    });

    it('uses a stored input default for an unconnected value', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'idx', type: 'int-source' },
                { id: 'a', type: 'float-source' },
                {
                    id: 'mux',
                    type: 'select-index',
                    controlValues: { count: 2 },
                    inputDefaults: { value_2: 7 },
                },
                { id: 'show', type: 'print' },
            ],
            connections: [
                { fromNode: 'idx', fromIndex: 0, toNode: 'mux', toIndex: 0 },
                { fromNode: 'a', fromIndex: 0, toNode: 'mux', toIndex: 1 },
                { fromNode: 'mux', fromIndex: 0, toNode: 'show', toIndex: 2 },
            ],
        });

        const result = await transpileGraph(runtime, graph);
        const flat = compactCode(result.code);

        assert.ok(
            flat.includes('elif _select_index_mux == 1: node_mux_out0 = 7'),
            'the node-level input default must replace the definition default'
        );
    });

    it('reads value_8 in the eighth branch of an eight-value mux', async () => {
        const runtime = buildRuntime();
        const sources = ['int-source', 'float-source', 'string-source', 'bool-source'];
        const nodes = Array.from({ length: 8 }, (_, index) => ({
            id: `s${index + 1}`,
            type: sources[index % sources.length],
        }));
        nodes.push({ id: 'mux', type: 'select-index', controlValues: { count: 8 } });
        nodes.push({ id: 'show', type: 'print' });

        const connections = nodes
            .filter((node) => /^s\d+$/.test(node.id))
            .map((node, index) => ({
                fromNode: node.id,
                fromIndex: 0,
                toNode: 'mux',
                toIndex: index + 1,
            }));
        connections.push({ fromNode: 'mux', fromIndex: 0, toNode: 'show', toIndex: 2 });

        const result = await transpileGraph(runtime, createGraph(runtime, { nodes, connections }));
        const flat = compactCode(result.code);

        assert.ok(
            flat.includes('elif _select_index_mux == 7: node_mux_out0 = node_s8_out0'),
            'value_8 must be read in the last branch'
        );
        assert.equal(flat.split('elif _select_index_mux ==').length - 1, 7);
    });

    it('defaults a missing index to zero', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'a', type: 'float-source' },
                { id: 'mux', type: 'select-index', controlValues: { count: 2 } },
                { id: 'show', type: 'print' },
            ],
            connections: [
                { fromNode: 'a', fromIndex: 0, toNode: 'mux', toIndex: 1 },
                { fromNode: 'mux', fromIndex: 0, toNode: 'show', toIndex: 2 },
            ],
        });

        const result = await transpileGraph(runtime, graph);

        assert.ok(compactCode(result.code).includes('_select_raw_mux = 0'));
    });

    it('emits no branch for a value the count hides', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'idx', type: 'int-source' },
                { id: 'hidden', type: 'string-source' },
                { id: 'mux', type: 'select-index', controlValues: { count: 2 } },
                { id: 'show', type: 'print' },
            ],
            connections: [
                { fromNode: 'idx', fromIndex: 0, toNode: 'mux', toIndex: 0 },
                { fromNode: 'hidden', fromIndex: 0, toNode: 'mux', toIndex: 3 },
                { fromNode: 'mux', fromIndex: 0, toNode: 'show', toIndex: 2 },
            ],
        });

        const result = await transpileGraph(runtime, graph);
        const flat = compactCode(result.code);

        assert.equal(flat.includes('_select_index_mux == 2'), false);
        assert.equal(flat.includes('node_mux_out0 = node_hidden_out0'), false);
    });

    it('omits the mux when its output is unconnected', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'idx', type: 'int-source' },
                { id: 'mux', type: 'select-index', controlValues: { count: 2 } },
            ],
            connections: [{ fromNode: 'idx', fromIndex: 0, toNode: 'mux', toIndex: 0 }],
        });

        const result = await transpileGraph(runtime, graph);
        const flat = compactCode(result.code);

        // The transpiler drops nodes without a live outgoing connection, so the
        // generator placeholder must not appear either.
        assert.match(result.code, /async def run\(\):/);
        assert.ok(flat.includes('node_idx_out0 = 1'));
        assert.equal(flat.includes('select-index output not connected'), false);
        assert.equal(flat.includes('_select_index_mux'), false);
    });

    it('keeps the emitted branches aligned with the NodeGraph union', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'idx', type: 'int-source' },
                { id: 'a', type: 'float-source' },
                { id: 'b', type: 'string-source' },
                { id: 'mux', type: 'select-index', controlValues: { count: 2 } },
                { id: 'show', type: 'print' },
            ],
            connections: [
                { fromNode: 'idx', fromIndex: 0, toNode: 'mux', toIndex: 0 },
                { fromNode: 'a', fromIndex: 0, toNode: 'mux', toIndex: 1 },
                { fromNode: 'b', fromIndex: 0, toNode: 'mux', toIndex: 2 },
                { fromNode: 'mux', fromIndex: 0, toNode: 'show', toIndex: 2 },
            ],
        });

        const definition = loadCoreDefinitions()['select-index'];
        const nodeGraph = new NodeGraph({ id: 'union-check' });
        const mux = nodeGraph.addNode({
            ...definition,
            type: 'core.select-index',
            controlValues: { count: 2 },
        });
        const floatSource = nodeGraph.addNode({
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'float' }],
        });
        const stringSource = nodeGraph.addNode({
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'string' }],
        });
        nodeGraph.addConnection({ fromNode: floatSource.id, fromIndex: 0, toNode: mux.id, toIndex: 1 });
        nodeGraph.addConnection({ fromNode: stringSource.id, fromIndex: 0, toNode: mux.id, toIndex: 2 });

        const union = nodeGraph.getResolvedOutputTypes(mux.id, 0);
        assert.deepEqual(union, ['float', 'string']);
        // The representative colour follows the resolved union instead of the
        // declared `any`/`initialTypes`, so the output cannot drift from policy.
        assert.equal(resolveUnionOutputType(union), 'float');

        const flat = compactCode((await transpileGraph(runtime, graph)).code);

        // One branch, and therefore one candidate, per resolved union member.
        assert.equal(flat.split('_select_index_mux ==').length - 1, 2);
        assert.ok(flat.includes('node_mux_out0 = node_a_out0'));
        assert.ok(flat.includes('node_mux_out0 = node_b_out0'));
    });
});
