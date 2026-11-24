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
const varsDefsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/vars/node_definitions.json'
);
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
    // The `core` package has no `vars.array` consumer, so the array-chain cases below write the
    // captured block through the `vars` package's var-write node.
    runtime.addNodeDefinition('var-write', {
        ...loadJson(varsDefsPath).nodeTypes['var-write'],
        packageId: 'vars',
        mpAssets: [],
        mpModuleRoots: [''],
    });
    return runtime;
}

function buildNode(type, id, runtime, { controlValues = {}, inputDefaults = {} } = {}) {
    const def = runtime.getNodeType(type);
    const inputs = (def.inputs || []).map((input) => ({ ...input }));
    const outputs = (def.outputs || []).map((output) => ({ ...output }));
    const controls = (def.controls || []).map((control) => ({ ...control }));
    return new MockNodeData({
        id,
        type,
        inputs,
        outputs,
        controls,
        controlValues,
        inputDefaults,
    });
}

function buildGraph(runtime) {
    const graph = new MockNodeGraph('g', 'PinGraph');
    graph.addNode('7', buildNode('adc-input', '7', runtime, { controlValues: { pin: 1 } }));
    graph.addNode(
        '8',
        buildNode('voltage-divider', '8', runtime, { controlValues: { topK: 100, bottomK: 22 } })
    );
    graph.addNode(
        '9',
        buildNode('digital-input', '9', runtime, { controlValues: { pin: 0, pull: null } })
    );
    graph.addNode('10', buildNode('digital-output', '10', runtime, { controlValues: { pin: 2 } }));
    graph.addNode('11', buildNode('dac-output', '11', runtime, { controlValues: { pin: 25 } }));
    graph.addConnection({ fromNode: '7', fromIndex: 0, toNode: '8', toIndex: 0 });
    graph.addConnection({ fromNode: '8', fromIndex: 0, toNode: '11', toIndex: 1 });
    graph.addConnection({ fromNode: '9', fromIndex: 0, toNode: '10', toIndex: 1 });
    return graph;
}

async function transpileGraph(runtime, graph) {
    const collection = new MockCollection('pins');
    collection.addGraph('g', graph);
    const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
    return transpiler.transpile(collection, { deviceRuntime: runtime });
}

function compactCode(code) {
    return code.replace(/\s+/g, ' ');
}

describe('core pin node transpiler integration', () => {
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

        await import(`${pathToFileURL(coreGeneratorsPath).href}?test=core-pin-transpiler`);
        await import(`${pathToFileURL(varsGeneratorsPath).href}?test=core-pin-transpiler`);
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

    it('transpiles the reference pin graph', async () => {
        const runtime = buildRuntime();
        const collection = new MockCollection('pins');
        collection.addGraph('g', buildGraph(runtime));

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const code = result.code;
        assert.ok(code.includes('from machine import ADC, Pin'));
        assert.ok(code.includes('_adc_7 = ADC(Pin(1))'));
        assert.ok(code.includes('_adc_7.atten(ADC.ATTN_11DB)'));
        assert.ok(code.includes('_adc_7.read_u16() / 65535.0 * 3.3'));
        assert.ok(code.includes('_pin_9.value()'));
        assert.ok(code.includes('_pin_10.value('));
        assert.ok(code.includes('_dac_11.write('));
        assert.ok(code.includes('((100) + (22)) / (22)'));
        assert.ok(
            compactCode(code).includes('if bool(True): _pin_10.value(node_9_out0)'),
            'digital output write should sit under the default enabled guard'
        );
        assert.ok(
            compactCode(code).includes('if bool(True): _dac_11.write('),
            'DAC write should sit under the default enabled guard'
        );
        assert.doesNotMatch(code.replace(/\s+/g, ' '), /\{\{/);
    });

    it('transpiles the default enabled value into the digital output guard', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('g', 'DigitalOutputDefault');
        graph.addNode(
            '1',
            buildNode('digital-output', '1', runtime, { controlValues: { pin: 2 } })
        );

        const result = await transpileGraph(runtime, graph);

        assert.ok(compactCode(result.code).includes('if bool(True): _pin_1.value(False)'));
    });

    it('transpiles a connected enabled input into the digital output guard', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('g', 'DigitalOutputConnected');
        graph.addNode('1', buildNode('bool-source', '1', runtime));
        graph.addNode(
            '2',
            buildNode('digital-output', '2', runtime, { controlValues: { pin: 2 } })
        );
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });

        const result = await transpileGraph(runtime, graph);

        assert.ok(compactCode(result.code).includes('if bool(node_1_out0): _pin_2.value(False)'));
    });

    it('transpiles enabled=false input defaults into the digital output guard', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('g', 'DigitalOutputDisabled');
        graph.addNode(
            '1',
            buildNode('digital-output', '1', runtime, {
                controlValues: { pin: 2 },
                inputDefaults: { enabled: false },
            })
        );

        const result = await transpileGraph(runtime, graph);

        assert.ok(compactCode(result.code).includes('if bool(False): _pin_1.value(False)'));
    });

    it('transpiles an adc-array block into a var-write', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('g', 'AdcBlock');
        graph.addNode(
            '1',
            buildNode('adc-array', '1', runtime, {
                controlValues: { pin: 34, sampleRate: 5000, blockSamples: 64 },
            })
        );
        graph.addNode(
            '2',
            buildNode('var-write', '2', runtime, { controlValues: { name: 'buf' } })
        );
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 2 });

        const result = await transpileGraph(runtime, graph);
        const code = result.code;
        assert.ok(code.includes('import array as _array'));
        assert.ok(code.includes('import time'));
        assert.ok(code.includes('_adc_blk_1 = ADC(Pin(34))'));
        assert.ok(code.includes('_adc_blk_1.atten(ADC.ATTN_11DB)'));
        assert.ok(code.includes("_adc_blk_buf_1 = _array.array('f', [0.0] * 64)"));
        assert.ok(code.includes('for _adc_blk_i_1 in range(64):'));
        assert.ok(code.includes('time.ticks_add(_adc_blk_next_1, 200)'));
        assert.ok(
            compactCode(code).includes("if bool(True): _store.set('default', 'buf', node_1_out0)"),
            'the captured block should reach the store under the default enabled guard'
        );
    });

    it('transpiles a 10 kHz 128-sample adc-array block', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('g', 'AdcBlockFast');
        graph.addNode(
            '1',
            buildNode('adc-array', '1', runtime, {
                controlValues: { pin: 34, sampleRate: 10000, blockSamples: 128 },
            })
        );
        graph.addNode(
            '2',
            buildNode('var-write', '2', runtime, { controlValues: { name: 'buf' } })
        );
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 2 });

        const result = await transpileGraph(runtime, graph);
        const code = result.code;

        assert.ok(code.includes("_adc_blk_buf_1 = _array.array('f', [0.0] * 128)"));
        assert.ok(code.includes('for _adc_blk_i_1 in range(128):'));
        assert.ok(code.includes('time.ticks_add(_adc_blk_next_1, 100)'));
    });

    it('keeps two adc-array blocks on separate variables', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('g', 'TwoAdcBlocks');
        graph.addNode(
            '1',
            buildNode('adc-array', '1', runtime, {
                controlValues: { pin: 34, sampleRate: 5000, blockSamples: 16 },
            })
        );
        graph.addNode(
            '2',
            buildNode('adc-array', '2', runtime, {
                controlValues: { pin: 35, sampleRate: 5000, blockSamples: 64 },
            })
        );
        graph.addNode(
            '3',
            buildNode('var-write', '3', runtime, { controlValues: { name: 'bufA' } })
        );
        graph.addNode(
            '4',
            buildNode('var-write', '4', runtime, { controlValues: { name: 'bufB' } })
        );
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '3', toIndex: 2 });
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '4', toIndex: 2 });

        const result = await transpileGraph(runtime, graph);
        const code = result.code;

        assert.ok(code.includes('_adc_blk_1 = ADC(Pin(34))'));
        assert.ok(code.includes("_adc_blk_buf_1 = _array.array('f', [0.0] * 16)"));
        assert.ok(code.includes('for _adc_blk_i_1 in range(16):'));
        assert.ok(code.includes('_adc_blk_2 = ADC(Pin(35))'));
        assert.ok(code.includes("_adc_blk_buf_2 = _array.array('f', [0.0] * 64)"));
        assert.ok(code.includes('for _adc_blk_i_2 in range(64):'));
        assert.ok(compactCode(code).includes("_store.set('default', 'bufA', node_1_out0)"));
        assert.ok(compactCode(code).includes("_store.set('default', 'bufB', node_2_out0)"));
    });

    it('omits the capture when the samples output is unconnected', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('g', 'AdcBlockUnconnected');
        graph.addNode('1', buildNode('adc-array', '1', runtime, { controlValues: { pin: 34 } }));

        const result = await transpileGraph(runtime, graph);
        const code = result.code;
        assert.ok(code.includes('_adc_blk_1 = ADC(Pin(34))'));
        assert.ok(code.includes("_adc_blk_buf_1 = _array.array('f', [0.0] * 64)"));
        assert.ok(!code.includes('read_u16'), 'an unconnected block must not sample');
        assert.ok(!code.includes('_adc_blk_next_1'));
        assert.ok(!code.includes('node_1_out0'));
    });
});
