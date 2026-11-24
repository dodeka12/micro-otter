import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

const PKG = 'src/micro_otter/nodes/device/node_pkgs';

const paths = {
    definitions: path.resolve(`${PKG}/time/node_definitions.json`),
    manifest: path.resolve(`${PKG}/time/manifest.json`),
    generators: path.resolve(`${PKG}/time/node_generators.js`),
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
    getId() { return this.id; }
    getType() { return this.type; }
}

class MockNodeGraph {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.nodes = new Map();
        this.connections = [];
    }
    getId() { return this.id; }
    getName() { return this.name; }
    getTriggerInterval() { return 100; }
    getNodes() { const r = {}; this.nodes.forEach((n, id) => { r[id] = n; }); return r; }
    addNode(id, node) { this.nodes.set(id, node); }
    getConnections() { return this.connections.slice(); }
    addConnection(connection) { this.connections.push({ ...connection }); }
}

class MockCollection {
    constructor(id) { this.id = id; this.graphs = new Map(); }
    getId() { return this.id; }
    getVersion() { return '1.0.0'; }
    getVersionString() { return '1.0.0'; }
    getTitle() { return this.id; }
    getGraphs() { const r = {}; this.graphs.forEach((g, id) => { r[id] = g; }); return r; }
    addGraph(id, graph) { this.graphs.set(id, graph); }
}

class MockRuntime {
    constructor() { this.definitions = new Map(); }
    addNodeDefinition(type, definition) { this.definitions.set(type, definition); }
    getNodeType(type) { return this.definitions.get(type) || null; }
}

function loadJson(filePath) { return JSON.parse(readFileSync(filePath, 'utf8')); }

function resolveMpAssets(manifest, nodeType) {
    const wildcard = Array.isArray(manifest.mpAssets?.['*']) ? manifest.mpAssets['*'] : [];
    const specific = Array.isArray(manifest.mpAssets?.[nodeType]) ? manifest.mpAssets[nodeType] : [];
    return [...wildcard, ...specific];
}

function buildRuntime() {
    const runtime = new MockRuntime();
    const manifest = loadJson(paths.manifest);
    for (const [type, definition] of Object.entries(loadJson(paths.definitions).nodeTypes)) {
        runtime.addNodeDefinition(type, {
            ...definition,
            packageId: 'time',
            mpAssets: resolveMpAssets(manifest, type),
            mpModuleRoots: manifest.mpModuleRoots || [''],
        });
    }
    return runtime;
}

function buildNode(type, id, runtime, controlValues = {}, inputDefaults = {}) {
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

function buildCollection(runtime) {
    const graph = new MockNodeGraph('time', 'Time');
    graph.addNode('1', buildNode('time-service', '1', runtime));
    graph.addNode('2', buildNode('time-status', '2', runtime));
    graph.addNode('3', buildNode('time-clock-parts', '3', runtime));
    graph.addNode('4', buildNode('time-date-parts', '4', runtime));
    graph.addNode('5', buildNode('time-between', '5', runtime, { start: '22:00', end: '06:00' }));
    graph.addNode('6', buildNode('time-format', '6', runtime, { pattern: '%H:%M' }));
    // A connected epoch input exercises the reference path next to the literal one.
    graph.addConnection({ fromNode: '3', fromIndex: 0, toNode: '5', toIndex: 0 });

    const collection = new MockCollection('time');
    collection.addGraph('time', graph);
    return collection;
}

async function transpile() {
    const runtime = buildRuntime();
    const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
    const result = await transpiler.transpile(buildCollection(runtime), { deviceRuntime: runtime });
    return result.code;
}

// The statements between the graph's `while True:` and its cadence block.
function loopBody(code) {
    const marker = 'while True:';
    const start = code.indexOf(marker);
    const end = code.indexOf('_next_run_ms = _utime.ticks_add');
    assert.ok(start >= 0 && end > start, 'expected a graph loop with a cadence deadline');
    return code.slice(start + marker.length, end);
}

describe('time transpiler integration', () => {
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
        await import(`${pathToFileURL(paths.generators).href}?test=time-integration`);
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

    it('emits one import set and one start call in a shared init function', async () => {
        const code = await transpile();

        assert.equal(code.split('import otter_time.service as _time_srv').length - 1, 1);
        assert.equal(code.split('import otter_time.parts as _parts').length - 1, 1);
        assert.equal(code.split('_time_srv.start()').length - 1, 1);
        assert.match(code, /async def init_time\(\):[\s\S]*_time_srv\.start\(\)/);
        assert.match(code, /async def run\(\):[\s\S]*await init_time\(\)/);
    });

    it('configures the service once, before every conversion statement', async () => {
        const code = await transpile();
        const body = loopBody(code);

        assert.equal(body.split('_time_srv.configure(').length - 1, 1);
        assert.ok(
            body.indexOf('_time_srv.configure(') < body.indexOf('_parts.clock_parts('),
            'configure must precede the conversions'
        );
        assert.ok(
            body.indexOf('_time_srv.configure(') < body.indexOf('_parts.between('),
            'configure must precede the window check'
        );
    });

    it('emits tuple assignments for the part nodes', async () => {
        const code = await transpile();
        const normalized = code.replace(/\s+/g, ' ');

        assert.match(
            normalized,
            /node_3_out0, node_3_out1, node_3_out2 = _parts\.clock_parts\(_time_srv\.epoch_or_now\(-1\), _time_srv\.timezone_from_argument\(-100\)\)/
        );
        assert.match(
            normalized,
            /node_4_out0, node_4_out1, node_4_out2, node_4_out3 = _parts\.date_parts\(_time_srv\.epoch_or_now\(-1\), _time_srv\.timezone_from_argument\(-100\)\)/
        );
    });

    it('wraps a connected epoch exactly once and embeds the window literals', async () => {
        const code = await transpile();
        const normalized = code.replace(/\s+/g, ' ');

        assert.match(
            normalized,
            /node_5_out0 = _parts\.between\(_time_srv\.epoch_or_now\(node_3_out0\), _time_srv\.timezone_from_argument\(-100\), '22:00', '06:00'\)/
        );
        assert.equal(normalized.split('epoch_or_now(node_3_out0)').length - 1, 1);
        assert.ok(!normalized.includes('epoch_or_now(_time_srv.epoch_or_now'));
    });

    it('emits the formatted text from the pattern control', async () => {
        const code = await transpile();
        const normalized = code.replace(/\s+/g, ' ');

        assert.match(
            normalized,
            /node_6_out0 = _parts\.format_time\(_time_srv\.epoch_or_now\(-1\), _time_srv\.timezone_from_argument\(-100\), '%H:%M'\)/
        );
    });

    it('emits the three status assignments in order', async () => {
        const code = await transpile();
        const body = loopBody(code);
        const lines = body
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('node_2_out'));

        assert.deepEqual(lines, [
            'node_2_out0 = _time_srv.now()',
            'node_2_out1 = _time_srv.synced()',
            'node_2_out2 = _time_srv.age()',
        ]);
    });

    it('never fetches, sleeps or loops inside a node statement', async () => {
        const code = await transpile();
        const body = loopBody(code);

        assert.ok(!body.includes('query_ntp'));
        assert.ok(!body.includes('sleep'));
        assert.ok(!body.includes('while'));
    });
});
