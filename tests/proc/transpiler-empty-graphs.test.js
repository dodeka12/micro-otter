// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Tests for empty graph handling in the Transpiler.
 *
 * Empty graphs (graphs without nodes) must be ignored instead of failing
 * transpilation. They should not emit graph functions or be awaited by the
 * generated `run()` entry point.
 */

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
    constructor(id, name, executionType = 'continuous') {
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
    getId() { return 'empty-graph-collection'; }
    getVersion() { return '1.0.0'; }
    getVersionString() { return '1.0.0'; }
    getTitle() { return 'Empty Graphs'; }
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
    // Mirrors the shipped nodes whose loop implementation is a comment only: the HA
    // bridge is configured in init_mqtt() and the MQTT will is published by the runtime.
    runtime.addNodeDefinition('comment-only', {
        title: 'Comment only',
        inputs: [],
        outputs: [],
        controls: [],
        implementations: { python: { type: 'regex', value: '# configured elsewhere' } },
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

function buildTranspiler() {
    return new Transpiler({ logger: { log: () => {}, debug: () => {} } });
}

describe('transpiler empty graph handling', () => {
    it('ignores empty graphs while transpiling non-empty graphs', async () => {
        const runtime = buildRuntime();
        const emptyGraph = new MockGraph('empty', 'Empty', 'continuous');
        const mainGraph = new MockGraph('main', 'Main', 'continuous');
        mainGraph.addNode('1', buildNode('emit', '1', runtime, { value: 1 }));

        const collection = new MockCollection();
        collection.addGraph('empty', emptyGraph);
        collection.addGraph('main', mainGraph);

        const result = await buildTranspiler().transpile(collection, { deviceRuntime: runtime });
        const code = result.code;

        assert.doesNotMatch(code, /async def empty\(/);
        assert.doesNotMatch(code, /await empty\(/);
        assert.match(code, /async def main\(\):/);
        assert.match(code, /await main\(\)/);
        assert.equal((code.match(/while True:/g) || []).length, 1);
    });

    it('ignores empty startup graphs', async () => {
        const runtime = buildRuntime();
        const emptyStartupGraph = new MockGraph('init', 'Init', 'startup');
        const mainGraph = new MockGraph('main', 'Main', 'continuous');
        mainGraph.addNode('1', buildNode('emit', '1', runtime, { value: 1 }));

        const collection = new MockCollection();
        collection.addGraph('init', emptyStartupGraph);
        collection.addGraph('main', mainGraph);

        const result = await buildTranspiler().transpile(collection, { deviceRuntime: runtime });
        const code = result.code;

        assert.doesNotMatch(code, /async def init\(/);
        assert.doesNotMatch(code, /await init\(/);
        assert.match(code, /async def main\(\):/);
        assert.match(code, /await main\(\)/);
    });

    it('produces valid code when every graph is empty', async () => {
        const runtime = buildRuntime();
        const collection = new MockCollection();
        collection.addGraph('init', new MockGraph('init', 'Init', 'startup'));
        collection.addGraph('empty', new MockGraph('empty', 'Empty', 'continuous'));

        const result = await buildTranspiler().transpile(collection, { deviceRuntime: runtime });
        const code = result.code;

        assert.match(code, /async def run\(\):/);
        assert.match(code, /async def run\(\):\n {4}pass/);
        assert.equal((code.match(/async def /g) || []).length, 1);
        assert.equal((code.match(/while True:/g) || []).length, 0);
        assert.doesNotMatch(code, /asyncio\.create_task/);
        assert.doesNotMatch(code, /await empty|await init/);
    });

    it('emits pass when a graph body would only contain comments', async () => {
        // A startup graph whose only node generates a comment (the HA bridge) used to
        // emit `async def init():` with no statement. mpy-cross rejects that with
        // `SyntaxError: invalid syntax`, so the whole app failed to load and nothing was
        // ever registered with Home Assistant.
        const runtime = buildRuntime();
        const initGraph = new MockGraph('init', 'Init', 'startup');
        initGraph.addNode('1', buildNode('comment-only', '1', runtime));
        const mainGraph = new MockGraph('main', 'Main', 'continuous');
        mainGraph.addNode('2', buildNode('emit', '2', runtime, { value: 1 }));

        const collection = new MockCollection();
        collection.addGraph('init', initGraph);
        collection.addGraph('main', mainGraph);

        const result = await buildTranspiler().transpile(collection, { deviceRuntime: runtime });

        assert.match(result.code, /async def init\(\):\n(?: {4}#[^\n]*\n)+ {4}pass\n/);
    });

    it('emits pass for a comment-only collection without continuous graphs', async () => {
        // The same empty-body rule applies to every emitted function: a collection whose
        // only graph is a comment-only startup graph must still parse, otherwise the
        // generated module fails to load and the device never runs the app at all.
        const runtime = buildRuntime();
        const initGraph = new MockGraph('init', 'Init', 'startup');
        initGraph.addNode('1', buildNode('comment-only', '1', runtime));

        const collection = new MockCollection();
        collection.addGraph('init', initGraph);

        const result = await buildTranspiler().transpile(collection, { deviceRuntime: runtime });

        assert.match(result.code, /async def init\(\):\n(?: {4}#[^\n]*\n)+ {4}pass\n/);
    });

    it('still rejects collections without any graphs', async () => {
        const runtime = buildRuntime();
        const collection = new MockCollection();

        await assert.rejects(
            buildTranspiler().transpile(collection, { deviceRuntime: runtime }),
            /Collection has no graphs to transpile/
        );
    });
});
