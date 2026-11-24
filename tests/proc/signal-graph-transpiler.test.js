import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

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
        this.inputDefaults = inputDefaults;
    }

    getId() {
        return this.id;
    }

    getType() {
        return this.type;
    }
}

class MockGraph {
    constructor(
        id,
        name,
        executionType,
        {
            signalNames = [],
            signalMode = 'any',
            runOnStart = true,
            triggerInterval = 100,
            enabled = true,
        } = {}
    ) {
        this.id = id;
        this.name = name;
        this.executionType = executionType;
        this.signalNames = signalNames;
        this.signalMode = signalMode;
        this.runOnStart = runOnStart;
        this.triggerInterval = triggerInterval;
        this.enabled = enabled;
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
        return this.triggerInterval;
    }

    getExecutionType() {
        return this.executionType;
    }

    getSignalNames() {
        return this.signalNames;
    }

    getSignalMode() {
        return this.signalMode;
    }

    getRunOnStart() {
        return this.runOnStart;
    }

    getEnabled() {
        return this.enabled;
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

function buildRuntime() {
    const runtime = new MockRuntime();
    const defs = JSON.parse(readFileSync(varsDefsPath, 'utf8')).nodeTypes;
    for (const [type, def] of Object.entries(defs)) {
        runtime.addNodeDefinition(type, { ...def, packageId: 'vars' });
    }
    runtime.addNodeDefinition('emit', {
        title: 'Emit',
        inputs: [],
        outputs: [],
        controls: [],
        implementations: { python: { type: 'regex', value: '_ = 1' } },
    });
    return runtime;
}

function buildNode(type, id, runtime, controlValues = {}) {
    const def = runtime.getNodeType(type);
    const inputs = (def.inputs || []).map((input) => ({ ...input }));
    const outputs = (def.outputs || []).map((output) => ({ ...output }));
    const controls = (def.controls || []).map((control) => ({ ...control }));
    return new MockNodeData({ id, type, inputs, outputs, controls, controlValues });
}

async function transpile(collection) {
    const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
    return transpiler.transpile(collection, { deviceRuntime: buildRuntime() });
}

function significantLines(code) {
    return code
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
}

describe('signal graph transpiler', () => {
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
        await import(`${pathToFileURL(varsGeneratorsPath).href}?test=signal-graph-transpiler`);
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

    function eventGraph(id, name, options) {
        const runtime = buildRuntime();
        const graph = new MockGraph(id, name, 'event', options);
        graph.addNode('emit', buildNode('emit', 'emit', runtime));
        return graph;
    }

    it('emits the golden run-on-start loop', async () => {
        const graph = eventGraph('graph-2', 'Radar', { signalNames: ['radar-run'] });
        const collection = new MockCollection('c');
        collection.addGraph('graph-2', graph);

        const result = await transpile(collection);
        const lines = significantLines(result.code);

        const defineIndex = lines.indexOf("_signals.define('graph-2', ('radar-run',), 'any')");
        assert.ok(defineIndex >= 0, 'expected the define line');
        assert.ok(lines.indexOf('_first_run = True') > defineIndex);
        assert.ok(lines.indexOf('while True:') > defineIndex);
        assert.ok(lines.indexOf('if not _first_run:') > defineIndex);
        assert.ok(lines.indexOf("await _signals.wait('graph-2')") > defineIndex);
        assert.ok(lines.indexOf('_first_run = False') > defineIndex);
        assert.ok(lines.indexOf('await asyncio.sleep_ms(0)') > defineIndex);
        assert.ok(lines.indexOf('await asyncio.sleep_ms(0)') > lines.indexOf('_ = 1'));
        assert.ok(lines.includes('import otter_vars.signals as _signals'));
        assert.ok(!lines.some((line) => line.includes('_utime')));
        assert.ok(!lines.some((line) => line.includes('_next_run_ms')));
    });

    it('omits the first-run prologue when runOnStart is false', async () => {
        const graph = eventGraph('g1', 'Radar', {
            signalNames: ['radar-run'],
            runOnStart: false,
        });
        const collection = new MockCollection('c');
        collection.addGraph('g1', graph);

        const result = await transpile(collection);
        const lines = significantLines(result.code);
        assert.ok(!lines.some((line) => line.includes('_first_run')));
        const whileIndex = lines.indexOf('while True:');
        assert.equal(lines.indexOf("await _signals.wait('g1')"), whileIndex + 2);
    });

    it('emits all-mode define with a trailing comma for a single name', async () => {
        const single = eventGraph('g1', 'Radar', {
            signalNames: ['a'],
            signalMode: 'all',
        });
        const singleCollection = new MockCollection('c');
        singleCollection.addGraph('g1', single);
        const singleResult = await transpile(singleCollection);
        assert.ok(
            significantLines(singleResult.code).includes("_signals.define('g1', ('a',), 'all')")
        );

        const multi = eventGraph('g2', 'Both', {
            signalNames: ['a', 'b'],
            signalMode: 'all',
        });
        const multiCollection = new MockCollection('c');
        multiCollection.addGraph('g2', multi);
        const multiResult = await transpile(multiCollection);
        assert.ok(
            significantLines(multiResult.code).includes("_signals.define('g2', ('a', 'b'), 'all')")
        );
    });


    it('keeps utime only for continuous graphs', async () => {
        const event = eventGraph('e', 'Radar', { signalNames: ['a'] });
        const runtime = buildRuntime();
        const loop = new MockGraph('c', 'Loop', 'continuous', { triggerInterval: 500 });
        loop.addNode('emit', buildNode('emit', 'emit', runtime));

        const collection = new MockCollection('c');
        collection.addGraph('e', event);
        collection.addGraph('c', loop);

        const result = await transpile(collection);
        assert.ok(result.code.includes('import utime as _utime'));
        assert.ok(result.code.includes('_next_run_ms'));
    });

    it('registers the signals import exactly once with two event graphs', async () => {
        const a = eventGraph('a', 'A', { signalNames: ['x'] });
        const b = eventGraph('b', 'B', { signalNames: ['y'] });
        const collection = new MockCollection('c');
        collection.addGraph('a', a);
        collection.addGraph('b', b);

        const result = await transpile(collection);
        assert.equal(
            result.code.split('import otter_vars.signals as _signals').length - 1,
            1
        );
    });

    it('rejects an enabled event graph with no signals but tolerates a disabled one', async () => {
        const enabled = eventGraph('e', 'Radar', { signalNames: [] });
        const enabledCollection = new MockCollection('c');
        enabledCollection.addGraph('e', enabled);
        await assert.rejects(
            () => transpile(enabledCollection),
            /Event-triggered graph "Radar" has no signals selected/
        );

        const disabled = eventGraph('d', 'Radar', { signalNames: [], enabled: false });
        const runtime = buildRuntime();
        const keep = new MockGraph('k', 'Keep', 'continuous');
        keep.addNode('emit', buildNode('emit', 'emit', runtime));
        const collection = new MockCollection('c');
        collection.addGraph('d', disabled);
        collection.addGraph('k', keep);
        const result = await transpile(collection);
        assert.ok(result.code.includes('_ = 1'));
    });

    it('dispatches a mixed collection as one startup plus two tasks', async () => {
        const runtime = buildRuntime();
        const startup = new MockGraph('s', 'Start', 'startup');
        startup.addNode('emit', buildNode('emit', 'emit', runtime));
        const event = eventGraph('e', 'Radar', { signalNames: ['a'] });
        const loop = new MockGraph('c', 'Loop', 'continuous');
        loop.addNode('emit', buildNode('emit', 'emit', runtime));

        const collection = new MockCollection('c');
        collection.addGraph('s', startup);
        collection.addGraph('e', event);
        collection.addGraph('c', loop);

        const result = await transpile(collection);
        assert.equal((result.code.match(/asyncio\.create_task\(/g) || []).length, 2);
        assert.ok(result.code.includes('await asyncio.gather(*tasks)'));
        assert.ok(result.code.indexOf('await start()') < result.code.indexOf('tasks = ['));
    });

    it('treats a graph without getSignalNames as an empty watch list', async () => {
        const runtime = buildRuntime();
        const graph = new MockGraph('g1', 'Radar', 'event');
        graph.addNode('emit', buildNode('emit', 'emit', runtime));
        const collection = new MockCollection('c');
        collection.addGraph('g1', graph);

        await assert.rejects(
            () => transpile(collection),
            /Event-triggered graph "Radar" has no signals selected/
        );
    });

    it('treats a graph without getExecutionType as continuous', async () => {
        const runtime = buildRuntime();
        const graph = new MockGraph('g1', 'Loop', undefined, { triggerInterval: 100 });
        graph.addNode('emit', buildNode('emit', 'emit', runtime));
        const collection = new MockCollection('c');
        collection.addGraph('g1', graph);

        const result = await transpile(collection);
        assert.ok(result.code.includes('import utime as _utime'));
        assert.ok(!result.code.includes('_signals'));
    });

    it('emits signal posts before the wait when the graph contains a signal-post node', async () => {
        const runtime = buildRuntime();
        const graph = new MockGraph('graph-2', 'Radar', 'event', {
            signalNames: ['radar-run'],
        });
        graph.addNode('post', buildNode('signal-post', 'post', runtime, { signal: 'radar-done' }));
        const collection = new MockCollection('c');
        collection.addGraph('graph-2', graph);

        const result = await transpile(collection);
        const lines = significantLines(result.code);
        assert.ok(lines.includes("_signals.post('radar-done')"));
        const defineIndex = lines.indexOf("_signals.define('graph-2', ('radar-run',), 'any')");
        const waitIndex = lines.indexOf("await _signals.wait('graph-2')");
        const postIndex = lines.indexOf("_signals.post('radar-done')");
        assert.ok(defineIndex < waitIndex);
        assert.ok(waitIndex < postIndex);
    });
});

