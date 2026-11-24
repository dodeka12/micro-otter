import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import NodePackage from '../../src/micro_otter/nodes/html/js/data/node-package.js';
import { buildRuntimeNodeTypeSnapshot } from '../../src/micro_otter/nodes/html/js/data/runtime-node-definition-migration.js';
import { resolveUnionOutputType } from '../../src/micro_otter/nodes/html/js/data/type-conversions.js';
import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

const coreRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/core');
const coreDefinitionsPath = path.join(coreRoot, 'node_definitions.json');
const coreDataTypesPath = path.join(coreRoot, 'data_types.json');
const coreManifestPath = path.join(coreRoot, 'manifest.json');
const coreGeneratorsPath = path.join(coreRoot, 'node_generators.js');

/**
 * Minimal typed sources so the tuple nodes receive real connector types
 * without leaning on the const node's control-driven typing.
 */
const SOURCE_NODES = {
    'float-source': { outputType: 'float', value: '1.5' },
    'int-source': { outputType: 'int', value: '99' },
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
 * @param {{controlValues?: object, inputDefaults?: object}} options - Stored values.
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
function createGraph(runtime, { id = 'tuple-graph', nodes = [], connections = [] } = {}) {
    const graph = new MockNodeGraph(id, id);
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
    const collection = new MockCollection('tuple-integration');
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

/**
 * Count non-overlapping occurrences of a needle.
 * @param {string} haystack - Text to search.
 * @param {string} needle - Text to count.
 * @returns {number} Number of occurrences.
 */
function countOccurrences(haystack, needle) {
    return haystack.split(needle).length - 1;
}

/**
 * Connect a node output to the `in0` value input of a print sink.
 * @param {string} fromNode - Producing node id.
 * @param {number} fromIndex - Producing output index.
 * @param {string} toNode - Print node id.
 * @returns {object} Connection spec targeting the print value input.
 */
function toPrintValue(fromNode, fromIndex, toNode) {
    return { fromNode, fromIndex, toNode, toIndex: 2 };
}

describe('core tuple transpiler integration', () => {
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

        await import(`${pathToFileURL(coreGeneratorsPath).href}?test=core-tuple-transpiler`);
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


    it('transpiles a compose/decompose pipeline into the generated entry point', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'float', type: 'float-source' },
                { id: 'text', type: 'string-source' },
                { id: 'pair', type: 'compose', controlValues: { count: 2 } },
                { id: 'items', type: 'decompose', controlValues: { count: 2 } },
                { id: 'show', type: 'print' },
            ],
            connections: [
                { fromNode: 'float', fromIndex: 0, toNode: 'pair', toIndex: 0 },
                { fromNode: 'text', fromIndex: 0, toNode: 'pair', toIndex: 1 },
                { fromNode: 'pair', fromIndex: 0, toNode: 'items', toIndex: 0 },
                toPrintValue('items', 0, 'show'),
            ],
        });

        const result = await transpileGraph(runtime, graph);
        const flat = compactCode(result.code);

        // The entry-point marker proves the transpiler produced a runnable graph,
        // so the statement assertions below cannot pass on an empty result.
        assert.match(result.code, /async def run\(\):/);
        assert.ok(
            flat.includes('node_pair_out0 = (node_float_out0, node_text_out0,)'),
            'compose must emit the tuple literal from its connected inputs'
        );
        assert.ok(
            flat.includes('_tuple_items = node_pair_out0'),
            'decompose must read the composed tuple through its node-scoped temp'
        );
        assert.ok(
            flat.includes(
                'node_items_out0 = _tuple_items[0] if isinstance(_tuple_items, tuple) and len(_tuple_items) > 0 else None'
            ),
            'decompose must guard the position read'
        );
    });

    it('composes the minimum two-position tuple with a single assignment', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'float', type: 'float-source' },
                { id: 'text', type: 'string-source' },
                { id: 'pair', type: 'compose', controlValues: { count: 2 } },
                { id: 'items', type: 'decompose', controlValues: { count: 2 } },
            ],
            connections: [
                { fromNode: 'float', fromIndex: 0, toNode: 'pair', toIndex: 0 },
                { fromNode: 'text', fromIndex: 0, toNode: 'pair', toIndex: 1 },
                { fromNode: 'pair', fromIndex: 0, toNode: 'items', toIndex: 0 },
            ],
        });

        const result = await transpileGraph(runtime, graph);
        const flat = compactCode(result.code);

        assert.equal(countOccurrences(flat, 'node_pair_out0 = ('), 1);
        assert.ok(flat.includes('(node_float_out0, node_text_out0,)'));
    });

    it('composes all eight positions in declaration order', async () => {
        const runtime = buildRuntime();
        const sources = ['float-source', 'string-source', 'bool-source', 'tuple-source'];
        const nodes = Array.from({ length: 8 }, (_, index) => ({
            id: `s${index + 1}`,
            type: sources[index % sources.length],
        }));
        nodes.push({ id: 'pair', type: 'compose', controlValues: { count: 8 } });
        nodes.push({ id: 'items', type: 'decompose', controlValues: { count: 8 } });

        const connections = nodes
            .filter((node) => node.id.startsWith('s'))
            .map((node, index) => ({
                fromNode: node.id,
                fromIndex: 0,
                toNode: 'pair',
                toIndex: index,
            }));
        connections.push({ fromNode: 'pair', fromIndex: 0, toNode: 'items', toIndex: 0 });

        const result = await transpileGraph(runtime, createGraph(runtime, { nodes, connections }));
        const flat = compactCode(result.code);
        const expected = [1, 2, 3, 4, 5, 6, 7, 8]
            .map((index) => `node_s${index}_out0`)
            .join(', ');

        assert.equal(countOccurrences(flat, 'node_pair_out0 = ('), 1);
        assert.ok(
            flat.includes(`node_pair_out0 = (${expected},)`),
            'all eight composes must appear in connector order'
        );
    });

    it('composes unconnected positions as literal None', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'first', type: 'float-source' },
                { id: 'third', type: 'string-source' },
                { id: 'pair', type: 'compose', controlValues: { count: 3 } },
                { id: 'items', type: 'decompose', controlValues: { count: 3 } },
            ],
            connections: [
                { fromNode: 'first', fromIndex: 0, toNode: 'pair', toIndex: 0 },
                { fromNode: 'third', fromIndex: 0, toNode: 'pair', toIndex: 2 },
                { fromNode: 'pair', fromIndex: 0, toNode: 'items', toIndex: 0 },
            ],
        });

        const result = await transpileGraph(runtime, graph);
        const flat = compactCode(result.code);

        assert.ok(flat.includes('node_pair_out0 = (node_first_out0, None, node_third_out0,)'));
    });

    it('emits no assignment when the compose output is unconnected', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'float', type: 'float-source' },
                { id: 'text', type: 'string-source' },
                { id: 'pair', type: 'compose', controlValues: { count: 2 } },
            ],
            connections: [
                { fromNode: 'float', fromIndex: 0, toNode: 'pair', toIndex: 0 },
                { fromNode: 'text', fromIndex: 0, toNode: 'pair', toIndex: 1 },
            ],
        });

        const result = await transpileGraph(runtime, graph);

        // The generator still reports the idle path, but the transpiler drops
        // comment-only statements, so only the node header survives.
        const idle = globalThis.NodeCodeGenerators.composeNode({
            node: { id: 'pair', controlValues: { count: 2 } },
            inputs: ['node_float_out0', 'node_text_out0'],
            outputs: ['node_pair_out0'],
            outputsMeta: [{ id: 'tuple', connected: false }],
            helpers: {},
        });
        assert.equal(idle.statement, '# compose output not connected');
        assert.deepEqual(idle.outputs, []);

        assert.ok(result.code.includes('# compose [compose]'));
        assert.equal(result.code.includes('node_pair_out0'), false);
        assert.equal(result.code.includes('(node_float_out0, node_text_out0,)'), false);
    });

    it('decomposes only the connected positions of a composed tuple', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'float', type: 'float-source' },
                { id: 'text', type: 'string-source' },
                { id: 'pair', type: 'compose', controlValues: { count: 2 } },
                { id: 'items', type: 'decompose', controlValues: { count: 2 } },
                { id: 'showA', type: 'print' },
                { id: 'showB', type: 'print' },
            ],
            connections: [
                { fromNode: 'float', fromIndex: 0, toNode: 'pair', toIndex: 0 },
                { fromNode: 'text', fromIndex: 0, toNode: 'pair', toIndex: 1 },
                { fromNode: 'pair', fromIndex: 0, toNode: 'items', toIndex: 0 },
                toPrintValue('items', 0, 'showA'),
                toPrintValue('items', 1, 'showB'),
            ],
        });

        const result = await transpileGraph(runtime, graph);
        const flat = compactCode(result.code);

        assert.equal(countOccurrences(flat, '_tuple_items = node_pair_out0'), 1);
        assert.ok(
            flat.includes(
                'node_items_out0 = _tuple_items[0] if isinstance(_tuple_items, tuple) and len(_tuple_items) > 0 else None'
            )
        );
        assert.ok(
            flat.includes(
                'node_items_out1 = _tuple_items[1] if isinstance(_tuple_items, tuple) and len(_tuple_items) > 1 else None'
            )
        );
        assert.equal(flat.includes('_tuple_items[2]'), false);
    });

    it('reads positions 0 and 7 of the same tuple through the range guard', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'float', type: 'float-source' },
                { id: 'text', type: 'string-source' },
                { id: 'pair', type: 'compose', controlValues: { count: 2 } },
                { id: 'first', type: 'tuple-select', inputDefaults: { index: 0 } },
                { id: 'last', type: 'tuple-select', inputDefaults: { index: 7 } },
                { id: 'showA', type: 'print' },
                { id: 'showB', type: 'print' },
            ],
            connections: [
                { fromNode: 'float', fromIndex: 0, toNode: 'pair', toIndex: 0 },
                { fromNode: 'text', fromIndex: 0, toNode: 'pair', toIndex: 1 },
                { fromNode: 'pair', fromIndex: 0, toNode: 'first', toIndex: 0 },
                { fromNode: 'pair', fromIndex: 0, toNode: 'last', toIndex: 0 },
                toPrintValue('first', 0, 'showA'),
                toPrintValue('last', 0, 'showB'),
            ],
        });

        const result = await transpileGraph(runtime, graph);
        const flat = compactCode(result.code);

        assert.ok(flat.includes('_tuple_first = node_pair_out0'));
        assert.ok(flat.includes('_tuple_last = node_pair_out0'));
        assert.ok(flat.includes('_index_first = int(0) if isinstance(0, (int, float)) else -1'));
        assert.ok(flat.includes('_index_last = int(7) if isinstance(7, (int, float)) else -1'));
        assert.ok(
            flat.includes(
                'node_first_out0 = _tuple_first[_index_first] if isinstance(_tuple_first, tuple) and 0 <= _index_first < len(_tuple_first) else 0'
            )
        );
        assert.ok(
            flat.includes(
                'node_last_out0 = _tuple_last[_index_last] if isinstance(_tuple_last, tuple) and 0 <= _index_last < len(_tuple_last) else 0'
            ),
            'the out-of-range index must still be bounded by the generated guard'
        );
    });

    it('rejects a float source on the tuple input and still guards the read', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'number', type: 'float-source' },
                { id: 'pick', type: 'tuple-select', inputDefaults: { index: 0 } },
                { id: 'show', type: 'print' },
            ],
            connections: [
                { fromNode: 'number', fromIndex: 0, toNode: 'pick', toIndex: 0 },
                toPrintValue('pick', 0, 'show'),
            ],
        });

        // The transpiler validates connector types before it runs a generator, so a
        // float-to-tuple wiring never reaches the device.
        await assert.rejects(
            () => transpileGraph(runtime, graph),
            /cannot accept source type "float"/
        );

        // Even if a caller bypasses that validation, the generator stays defensive
        // instead of emitting a bare subscript.
        const result = globalThis.NodeCodeGenerators.tupleSelectNode({
            node: { id: 'pick', controlValues: {} },
            inputs: ['node_number_out0', '0'],
            outputs: ['node_pick_out0'],
            outputsMeta: [{ id: 'value', connected: true }],
            helpers: {},
        });

        assert.ok(result.statement.includes('_tuple_pick = node_number_out0'));
        assert.ok(
            result.statement.includes(
                'node_pick_out0 = _tuple_pick[_index_pick] if isinstance(_tuple_pick, tuple) and 0 <= _index_pick < len(_tuple_pick) else 0'
            )
        );
    });

    it('falls back to the default 0 when the tuple input is missing', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'pick', type: 'tuple-select', inputDefaults: { index: 0 } },
                { id: 'show', type: 'print' },
            ],
            connections: [toPrintValue('pick', 0, 'show')],
        });

        const result = await transpileGraph(runtime, graph);
        const flat = compactCode(result.code);

        assert.ok(flat.includes('_tuple_pick = None'));
        assert.ok(
            flat.includes(
                'node_pick_out0 = _tuple_pick[_index_pick] if isinstance(_tuple_pick, tuple) and 0 <= _index_pick < len(_tuple_pick) else 0'
            )
        );
    });

    it('honors the clamp and wrap index modes', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'float', type: 'float-source' },
                { id: 'text', type: 'string-source' },
                { id: 'pair', type: 'compose', controlValues: { count: 2 } },
                {
                    id: 'clamped',
                    type: 'tuple-select',
                    controlValues: { indexMode: 'clamp' },
                    inputDefaults: { index: 5 },
                },
                {
                    id: 'wrapped',
                    type: 'tuple-select',
                    controlValues: { indexMode: 'wrap' },
                    inputDefaults: { index: 5 },
                },
                { id: 'showA', type: 'print' },
                { id: 'showB', type: 'print' },
            ],
            connections: [
                { fromNode: 'float', fromIndex: 0, toNode: 'pair', toIndex: 0 },
                { fromNode: 'text', fromIndex: 0, toNode: 'pair', toIndex: 1 },
                { fromNode: 'pair', fromIndex: 0, toNode: 'clamped', toIndex: 0 },
                { fromNode: 'pair', fromIndex: 0, toNode: 'wrapped', toIndex: 0 },
                toPrintValue('clamped', 0, 'showA'),
                toPrintValue('wrapped', 0, 'showB'),
            ],
        });

        const result = await transpileGraph(runtime, graph);
        const flat = compactCode(result.code);

        assert.ok(flat.includes('_index_clamped = int(5) if isinstance(5, (int, float)) else None'));
        assert.ok(flat.includes('_index_wrapped = int(5) if isinstance(5, (int, float)) else None'));
        assert.ok(
            flat.includes(
                'node_clamped_out0 = _tuple_clamped[max(0, min(_index_clamped, len(_tuple_clamped) - 1))] if isinstance(_tuple_clamped, tuple) and _index_clamped is not None and len(_tuple_clamped) > 0 else None'
            )
        );
        assert.ok(
            flat.includes(
                'node_wrapped_out0 = _tuple_wrapped[_index_wrapped % len(_tuple_wrapped)] if isinstance(_tuple_wrapped, tuple) and _index_wrapped is not None and len(_tuple_wrapped) > 0 else None'
            )
        );
        assert.equal(
            flat.includes(
                'node_clamped_out0 = _tuple_clamped[max(0, min(_index_clamped, len(_tuple_clamped) - 1))] if isinstance(_tuple_clamped, tuple) and _index_clamped is not None and len(_tuple_clamped) > 0 else 0'
            ),
            false
        );
        assert.equal(flat.includes('_tuple_clamped[_index_clamped % len(_tuple_clamped)]'), false);
    });

    it('reads a wired default connector and ignores it in clamp mode', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'float', type: 'float-source' },
                { id: 'text', type: 'string-source' },
                { id: 'pair', type: 'compose', controlValues: { count: 2 } },
                { id: 'retry', type: 'int-source' },
                {
                    id: 'picked',
                    type: 'tuple-select',
                    controlValues: { indexMode: 'default' },
                    inputDefaults: { index: 5 },
                },
                {
                    id: 'bounded',
                    type: 'tuple-select',
                    controlValues: { indexMode: 'clamp' },
                    inputDefaults: { index: 5 },
                },
                { id: 'showA', type: 'print' },
                { id: 'showB', type: 'print' },
            ],
            connections: [
                { fromNode: 'float', fromIndex: 0, toNode: 'pair', toIndex: 0 },
                { fromNode: 'text', fromIndex: 0, toNode: 'pair', toIndex: 1 },
                { fromNode: 'pair', fromIndex: 0, toNode: 'picked', toIndex: 0 },
                { fromNode: 'pair', fromIndex: 0, toNode: 'bounded', toIndex: 0 },
                { fromNode: 'retry', fromIndex: 0, toNode: 'picked', toIndex: 2 },
                { fromNode: 'retry', fromIndex: 0, toNode: 'bounded', toIndex: 2 },
                toPrintValue('picked', 0, 'showA'),
                toPrintValue('bounded', 0, 'showB'),
            ],
        });

        const result = await transpileGraph(runtime, graph);
        const flat = compactCode(result.code);

        assert.ok(
            flat.includes(
                'node_picked_out0 = _tuple_picked[_index_picked] if isinstance(_tuple_picked, tuple) and 0 <= _index_picked < len(_tuple_picked) else node_retry_out0'
            )
        );
        assert.ok(
            flat.includes(
                'node_bounded_out0 = _tuple_bounded[max(0, min(_index_bounded, len(_tuple_bounded) - 1))] if isinstance(_tuple_bounded, tuple) and _index_bounded is not None and len(_tuple_bounded) > 0 else None'
            )
        );
        assert.equal(
            flat.includes(
                'node_bounded_out0 = _tuple_bounded[max(0, min(_index_bounded, len(_tuple_bounded) - 1))] if isinstance(_tuple_bounded, tuple) and _index_bounded is not None and len(_tuple_bounded) > 0 else node_retry_out0'
            ),
            false
        );
    });

    it('selects between a tuple and a scalar branch with one ternary', async () => {
        const runtime = buildRuntime();
        const graph = createGraph(runtime, {
            nodes: [
                { id: 'flag', type: 'bool-source' },
                { id: 'tuple', type: 'tuple-source' },
                { id: 'number', type: 'float-source' },
                { id: 'choice', type: 'select' },
                { id: 'show', type: 'print' },
            ],
            connections: [
                { fromNode: 'flag', fromIndex: 0, toNode: 'choice', toIndex: 0 },
                { fromNode: 'tuple', fromIndex: 0, toNode: 'choice', toIndex: 1 },
                { fromNode: 'number', fromIndex: 0, toNode: 'choice', toIndex: 2 },
                toPrintValue('choice', 0, 'show'),
            ],
        });

        const result = await transpileGraph(runtime, graph);
        const flat = compactCode(result.code);

        assert.equal(
            countOccurrences(
                flat,
                'node_choice_out0 = (node_tuple_out0) if bool(node_flag_out0) else (node_number_out0)'
            ),
            1
        );
        ['condition_2', 'trueValue_2', 'falseValue_2', 'value_2'].forEach((artifact) => {
            assert.equal(
                result.code.includes(artifact),
                false,
                `the single-channel select must not emit ${artifact}`
            );
        });
    });
});

/**
 * Add a node from the shipped definitions to a data-model graph.
 * @param {NodeGraph} graph - Graph receiving the node.
 * @param {Record<string, object>} definitions - Core definitions keyed by type id.
 * @param {{id: string, type: string}} spec - Node instance spec.
 * @returns {object} Added node.
 */
function addDefinitionNode(graph, definitions, { id, type }) {
    return graph.addNode({ id, type, ...definitions[type] });
}

/**
 * Add a synthetic typed source to a data-model graph.
 * @param {NodeGraph} graph - Graph receiving the node.
 * @param {string} id - Node id.
 * @param {string} outputType - Declared output type.
 * @returns {object} Added node.
 */
function addSourceNode(graph, id, outputType) {
    return graph.addNode({ id, type: `${outputType}-source`, outputs: [{ id: 'out0', outputType }] });
}

/**
 * Add a synthetic typed target to a data-model graph.
 * @param {NodeGraph} graph - Graph receiving the node.
 * @param {string} id - Node id.
 * @param {string[]} allowedTypes - Accepted connector types.
 * @returns {object} Added node.
 */
function addTargetNode(graph, id, allowedTypes) {
    return graph.addNode({ id, type: 'target', inputs: [{ id: 'in0', allowedTypes }] });
}

/**
 * Create a JSON fetch response double.
 * @param {unknown} payload - Parsed JSON payload returned by the response.
 * @returns {object} Fetch-like response with `ok` and `json`.
 */
function createJsonResponse(payload) {
    return {
        ok: true,
        json: async () => payload,
    };
}

/**
 * Create a fetch double backed by a URL-to-payload map.
 * @param {Map<string, unknown>} payloadByUrl - Payload keyed by request URL.
 * @returns {(input: unknown) => Promise<object>} Fetch-like function returning mapped payloads.
 */
function createFetchFromMap(payloadByUrl) {
    return async (input) => {
        const url = String(input);
        if (!payloadByUrl.has(url)) {
            return { ok: false, json: async () => ({}) };
        }
        return createJsonResponse(payloadByUrl.get(url));
    };
}

/**
 * Read the shipped core manifest without the browser-only registrar paths.
 *
 * `NodePackage.load()` dynamically imports `generators` and `capabilityChecks`; those
 * specifiers only resolve inside the web app, so the metadata assertions keep every other
 * manifest field real and cover the generator wiring through the transpiler block above.
 * @returns {object} Manifest payload that `NodePackage` can load under Node.
 */
function readLoadableManifest() {
    const manifest = JSON.parse(readFileSync(coreManifestPath, 'utf8'));
    const loadable = { ...manifest };
    delete loadable.generators;
    delete loadable.capabilityChecks;
    return loadable;
}


describe('core tuple type integration', () => {
    it('resolves a mixed tuple/scalar select to any and blocks unsound targets', () => {
        const definitions = loadCoreDefinitions();
        const graph = new NodeGraph({ id: 'tuple-union-graph' });
        const flag = addSourceNode(graph, 'flag', 'bool');
        const tuple = addSourceNode(graph, 'tuple', 'core.tuple');
        const number = addSourceNode(graph, 'number', 'float');
        const choice = addDefinitionNode(graph, definitions, { id: 'choice', type: 'select' });

        graph.addConnection({ fromNode: flag.id, fromIndex: 0, toNode: choice.id, toIndex: 0 });
        graph.addConnection({ fromNode: tuple.id, fromIndex: 0, toNode: choice.id, toIndex: 1 });
        graph.addConnection({ fromNode: number.id, fromIndex: 0, toNode: choice.id, toIndex: 2 });

        assert.deepEqual(graph.getResolvedOutputTypes(choice.id, 0), ['core.tuple', 'float']);
        assert.equal(resolveUnionOutputType(['core.tuple', 'float']), 'any');

        const tupleTarget = addTargetNode(graph, 'tuple-target', ['core.tuple']);
        const floatTarget = addTargetNode(graph, 'float-target', ['float']);
        const anyTarget = addTargetNode(graph, 'any-target', ['any']);

        const toTuple = graph.canConnect(choice.id, 0, tupleTarget.id, 0);
        assert.equal(toTuple.valid, false);
        assert.match(toTuple.message, /union 'core\.tuple \| float'/);

        const toFloat = graph.canConnect(choice.id, 0, floatTarget.id, 0);
        assert.equal(toFloat.valid, false);
        assert.match(toFloat.message, /union 'core\.tuple \| float'/);

        const toAny = graph.canConnect(choice.id, 0, anyTarget.id, 0);
        assert.equal(toAny.valid, true);
    });

    it('connects tuple outputs to tuple and any inputs but not to float inputs', () => {
        const definitions = loadCoreDefinitions();
        const graph = new NodeGraph({ id: 'tuple-connection-graph' });
        const pair = addDefinitionNode(graph, definitions, { id: 'pair', type: 'compose' });
        const items = addDefinitionNode(graph, definitions, { id: 'items', type: 'decompose' });
        const pick = addDefinitionNode(graph, definitions, { id: 'pick', type: 'tuple-select' });
        const numberTarget = addTargetNode(graph, 'number-target', ['float']);
        const anyTarget = addTargetNode(graph, 'any-target', ['any']);

        assert.equal(graph.canConnect(pair.id, 0, items.id, 0).valid, true);
        assert.equal(graph.canConnect(pair.id, 0, pick.id, 0).valid, true);
        assert.equal(graph.canConnect(pair.id, 0, anyTarget.id, 0).valid, true);

        const rejected = graph.canConnect(pair.id, 0, numberTarget.id, 0);
        assert.equal(rejected.valid, false);
        assert.match(rejected.message, /Type mismatch/);
    });
});

describe('core tuple package metadata', () => {
    /**
     * Load the shipped core package through `NodePackage`.
     * @returns {Promise<NodePackage>} Loaded package.
     */
    async function loadCorePackage() {
        const fetchImpl = createFetchFromMap(
            new Map([
                ['/device/node_pkgs/core/manifest.json', readLoadableManifest()],
                ['/device/node_pkgs/core/node_definitions.json', { nodeTypes: loadCoreDefinitions() }],
                [
                    '/device/node_pkgs/core/data_types.json',
                    JSON.parse(readFileSync(coreDataTypesPath, 'utf8')),
                ],
            ])
        );

        const pkg = new NodePackage('/device/node_pkgs/core/');
        await pkg.load(fetchImpl);
        return pkg;
    }

    it('registers core.tuple with its value kind and connection policy', async () => {
        const pkg = await loadCorePackage();
        const tupleType = pkg.getDataTypes()['core.tuple'];

        assert.ok(tupleType);
        assert.equal(tupleType.kind, 'value');
        assert.equal(tupleType.color, '#9b7ad6');
        assert.deepEqual(tupleType.connectionPolicy, {
            input: { maxConnections: 1 },
            output: { maxConnections: 0 },
        });
    });

    it('loads the tuple nodes with their connector metadata intact', async () => {
        const pkg = await loadCorePackage();

        const compose = pkg.getNodeType('core.compose');
        assert.ok(compose);
        assert.deepEqual(compose.outputs.map((output) => output.outputType), ['core.tuple']);
        assert.deepEqual(compose.inputs.map((input) => input.allowedTypes), Array(8).fill(['any']));

        const decompose = pkg.getNodeType('core.decompose');
        assert.ok(decompose);
        assert.deepEqual(decompose.inputs.map((input) => input.allowedTypes), [['core.tuple']]);
        assert.deepEqual(
            decompose.outputs.map((output) => output.outputType),
            Array(8).fill('any')
        );

        const tupleSelect = pkg.getNodeType('core.tuple-select');
        assert.ok(tupleSelect);
        assert.deepEqual(tupleSelect.inputs.map((input) => input.id), [
            'tuple',
            'index',
            'default',
        ]);
        assert.deepEqual(tupleSelect.inputs[0].allowedTypes, ['core.tuple']);
        assert.deepEqual(tupleSelect.inputs[1].allowedTypes, ['int', 'float']);
        assert.deepEqual(tupleSelect.inputs[2].allowedTypes, ['int']);
        assert.deepEqual(tupleSelect.outputs.map((output) => output.id), ['value']);
        assert.equal(tupleSelect.outputs[0].outputType, 'any');
        assert.deepEqual(tupleSelect.controls.map((control) => control.id), ['indexMode']);
        assert.equal(tupleSelect.controls[0].affectsInputs, true);
        assert.deepEqual(
            tupleSelect.controls[0].options.map((option) => option.value),
            ['default', 'clamp', 'wrap']
        );
    });

    it('keeps the select union typing through the runtime snapshot', async () => {
        const pkg = await loadCorePackage();
        const select = pkg.getNodeType('core.select');

        assert.ok(select);
        assert.deepEqual(
            select.inputs.map((input) => input.id),
            ['condition', 'trueValue', 'falseValue']
        );
        assert.deepEqual(select.outputs.map((output) => output.id), ['value']);
        assert.equal(select.outputs[0].outputType, 'any');
        assert.deepEqual(select.outputs[0].initialTypes, [
            'bool',
            'int',
            'float',
            'string',
            'core.tuple',
        ]);
        assert.deepEqual(select.outputs[0].typeInputSources, ['trueValue', 'falseValue']);

        const snapshot = buildRuntimeNodeTypeSnapshot(loadCoreDefinitions().select, 'select');
        assert.equal(snapshot.outputs[0].outputType, 'any');
        assert.deepEqual(snapshot.outputs[0].initialTypes, [
            'bool',
            'int',
            'float',
            'string',
            'core.tuple',
        ]);
        assert.deepEqual(snapshot.outputs[0].typeInputSources, ['trueValue', 'falseValue']);
    });
});

