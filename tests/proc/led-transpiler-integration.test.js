import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

const PKG = 'src/micro_otter/nodes/device/node_pkgs';

const paths = {
    varsDefs: path.resolve(`${PKG}/vars/node_definitions.json`),
    varsManifest: path.resolve(`${PKG}/vars/manifest.json`),
    varsGenerators: path.resolve(`${PKG}/vars/node_generators.js`),
    ledDefs: path.resolve(`${PKG}/led/node_definitions.json`),
    ledManifest: path.resolve(`${PKG}/led/manifest.json`),
    ledGenerators: path.resolve(`${PKG}/led/node_generators.js`),
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
        const r = {};
        this.nodes.forEach((n, id) => {
            r[id] = n;
        });
        return r;
    }
    addNode(id, node) {
        this.nodes.set(id, node);
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
        const r = {};
        this.graphs.forEach((g, id) => {
            r[id] = g;
        });
        return r;
    }
    addGraph(id, graph) {
        this.graphs.set(id, graph);
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

function registerPackage(runtime, packageId, defsPath, manifestPath) {
    const defs = loadJson(defsPath).nodeTypes;
    const manifest = loadJson(manifestPath);
    for (const [type, def] of Object.entries(defs)) {
        runtime.addNodeDefinition(type, {
            ...def,
            packageId,
            mpAssets: resolveMpAssets(manifest, type),
            mpModuleRoots: manifest.mpModuleRoots || [''],
        });
    }
}

function buildRuntime() {
    const runtime = new MockRuntime();
    registerPackage(runtime, 'vars', paths.varsDefs, paths.varsManifest);
    registerPackage(runtime, 'led', paths.ledDefs, paths.ledManifest);
    return runtime;
}

function buildNode(type, id, runtime, controlValues = {}, inputDefaults = {}) {
    const def = runtime.getNodeType(type);
    const inputs = (def.inputs || []).map((input) => ({ ...input }));
    const outputs = (def.outputs || []).map((output) => ({ ...output }));
    const controls = (def.controls || []).map((control) => ({ ...control }));
    return new MockNodeData({ id, type, inputs, outputs, controls, controlValues, inputDefaults });
}

describe('led transpiler integration', () => {
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
        await import(`${pathToFileURL(paths.varsGenerators).href}?test=led-integration`);
        await import(`${pathToFileURL(paths.ledGenerators).href}?test=led-integration`);
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

    it('transpiles an array chain into a neopixel write with store buffering', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('led', 'Led');
        graph.addNode('1', buildNode('array-generate', '1', runtime, {}, { count: 60 }));
        graph.addNode(
            '2',
            buildNode('array-modify', '2', runtime, {
                modifyType: 'shift',
                wrap: true,
                clamp: false,
            })
        );
        graph.addNode('3', buildNode('var-write', '3', runtime, { name: 'buf' }));
        graph.addNode('4', buildNode('var-read', '4', runtime, { name: 'buf' }));
        graph.addNode(
            '5',
            buildNode('led-neopixel-output', '5', runtime, {
                pin: 2,
                count: 60,
                order: 'GRB',
                colorModel: 'single',
            })
        );
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 });
        graph.addConnection({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 2 });
        graph.addConnection({ fromNode: '4', fromIndex: 0, toNode: '5', toIndex: 1 });

        const collection = new MockCollection('led');
        collection.addGraph('led', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(result.code, /# Initialization[\s\S]*node_1_out0 = None[\s\S]*while True:/);
        assert.match(normalized, /node_1_out0 = _arr\.generate\(node_1_out0, 60\)/);
        assert.match(
            normalized,
            /node_2_out0 = _arr\.shift\(node_1_out0, 0, wrap=True, clamp=False, inplace=False\)/
        );
        assert.match(normalized, /_store\.set\('default', 'buf', node_2_out0\)/);
        assert.match(normalized, /node_4_out0 = _store\.get\('default', 'buf', 0\)/);
        assert.match(
            normalized,
            /_np_5 = NeoPixel\(pin=2, count=60, order='GRB', has_white=False\)/
        );
        assert.match(
            normalized,
            /if bool\(True\): _np_5\.write\(\[node_4_out0, node_4_out0, node_4_out0\]\)/
        );
        assert.ok(result.code.includes('import otter_vars.arrays as _arr'));
        assert.ok(result.code.includes('import otter_vars.store as _store'));
        assert.ok(result.code.includes('from otter_led.drivers.neopixel import NeoPixel'));
    });

    it('emits None for unconnected neopixel channels in rgb mode', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('led', 'Led');
        graph.addNode('1', buildNode('array-generate', '1', runtime, {}, { count: 60 }));
        graph.addNode(
            '5',
            buildNode('led-neopixel-output', '5', runtime, {
                pin: 2,
                count: 60,
                order: 'GRB',
                colorModel: 'rgb',
            })
        );
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '5', toIndex: 1 });

        const collection = new MockCollection('led');
        collection.addGraph('led', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(result.code, /# Initialization[\s\S]*node_1_out0 = None[\s\S]*while True:/);
        assert.match(
            normalized,
            /_np_5 = NeoPixel\(pin=2, count=60, order='GRB', has_white=False\)/
        );
        assert.match(normalized, /if bool\(True\): _np_5\.write\(\[node_1_out0, None, None\]\)/);
    });

    it('single-color broadcast connects emitted code to host-driver wire bytes', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('led', 'Led');
        graph.addNode('1', buildNode('array-generate', '1', runtime, {}, { count: 3 }));
        graph.addNode(
            '5',
            buildNode('led-neopixel-output', '5', runtime, {
                pin: 2,
                count: 3,
                order: 'GRB',
                colorModel: 'single',
            })
        );
        graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '5', toIndex: 1 });

        const collection = new MockCollection('led');
        collection.addGraph('led', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(
            normalized,
            /_np_5 = NeoPixel\(pin=2, count=3, order='GRB', has_white=False\)/
        );
        assert.match(
            normalized,
            /if bool\(True\): _np_5\.write\(\[node_1_out0, node_1_out0, node_1_out0\]\)/
        );

        const python = process.env.PYTHON || 'python3';
        const ledRoot = path.resolve(`${PKG}/led`);
        const script = [
            'import sys, array',
            `sys.path.insert(0, ${JSON.stringify(ledRoot)})`,
            'from otter_led.drivers.neopixel import NeoPixel',
            "arr = array.array('f', [0.5, 0.25, 1.0])",
            "print(list(NeoPixel(2, 3, order='GRB', has_white=False).write([arr, arr, arr])))",
            "print(list(NeoPixel(2, 3, order='GRB', has_white=False).write([0.5, 0.5, 0.5])))",
            "print(list(NeoPixel(2, 4, order='GRB', has_white=False).write([arr, arr, arr])))",
        ].join('\n');
        const out = execFileSync(python, ['-c', script], { encoding: 'utf8', stdio: 'pipe' });

        assert.ok(out.includes('[128, 128, 128, 64, 64, 64, 255, 255, 255]'));
        assert.ok(out.includes('[128, 128, 128, 128, 128, 128, 128, 128, 128]'));
        assert.ok(out.includes('[128, 128, 128, 64, 64, 64, 255, 255, 255, 0, 0, 0]'));
    });

    it('gates the LED loop with the stored enabled default', async () => {
        const runtime = buildRuntime();
        const graph = new MockNodeGraph('led', 'Led');
        graph.addNode(
            '6',
            buildNode('led-single-output', '6', runtime, { pin: 4 }, { enabled: false })
        );

        const collection = new MockCollection('led');
        collection.addGraph('led', graph);

        const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
        const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
        const normalized = result.code.replace(/\s+/g, ' ');

        assert.match(normalized, /_single_6 = SingleLed\(pin=4\)/);
        assert.match(normalized, /if bool\(False\): _single_6\.write\(0\)/);
    });
});
