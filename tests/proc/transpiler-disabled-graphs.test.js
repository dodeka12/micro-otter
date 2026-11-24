// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Tests for disabled graph handling in the Transpiler.
 *
 * A graph whose `enabled` flag is `false` is kept in the collection but must not
 * contribute anything to the generated firmware: no graph function, no `run()`
 * await, no imports and no validation. If every graph is disabled the
 * transpilation fails instead of emitting an empty runtime.
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
    constructor(id, name, executionType = 'continuous', enabled = true) {
        this.id = id;
        this.name = name;
        this.executionType = executionType;
        this.enabled = enabled;
        this.nodes = new Map();
        this.connections = [];
    }
    getId() { return this.id; }
    getName() { return this.name; }
    getTriggerInterval() { return 100; }
    getExecutionType() { return this.executionType; }
    getEnabled() { return this.enabled; }
    getNodes() { const r = {}; this.nodes.forEach((n, id) => { r[id] = n; }); return r; }
    addNode(id, node) { this.nodes.set(id, node); }
    getConnections() { return this.connections.slice(); }
}

/**
 * Structural graph mock without the optional `getEnabled` accessor. It mirrors
 * third-party and legacy graph objects and must behave as an enabled graph.
 */
class MockGraphWithoutEnabled {
    constructor(graph) {
        this.graph = graph;
    }
    getId() { return this.graph.getId(); }
    getName() { return this.graph.getName(); }
    getTriggerInterval() { return this.graph.getTriggerInterval(); }
    getExecutionType() { return this.graph.getExecutionType(); }
    getNodes() { return this.graph.getNodes(); }
    getConnections() { return this.graph.getConnections(); }
}

class MockCollection {
    constructor() { this.graphs = new Map(); }
    getId() { return 'disabled-graph-collection'; }
    getVersion() { return '1.0.0'; }
    getVersionString() { return '1.0.0'; }
    getTitle() { return 'Disabled Graphs'; }
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
    // Mirrors a shipped node that pulls in a module only it needs, so the tests can
    // prove that imports of a disabled graph disappear from the generated code.
    runtime.addNodeDefinition('import-needing', {
        title: 'Import needing',
        inputs: [],
        outputs: [{ id: 'out0', name: 'Out', outputType: 'float' }],
        controls: [],
        implementations: {
            python: {
                type: 'regex',
                value: 'print("import-needing")',
                imports: ['import machine'],
            },
        },
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

describe('transpiler disabled graph handling', () => {
    it('transpiles every graph when all of them are enabled', async () => {
        const runtime = buildRuntime();
        const alpha = new MockGraph('alpha', 'Alpha', 'continuous', true);
        alpha.addNode('1', buildNode('emit', '1', runtime, { value: 1 }));
        const beta = new MockGraph('beta', 'Beta', 'continuous', true);
        beta.addNode('2', buildNode('emit', '2', runtime, { value: 2 }));

        const collection = new MockCollection();
        collection.addGraph('alpha', alpha);
        collection.addGraph('beta', beta);

        const result = await buildTranspiler().transpile(collection, { deviceRuntime: runtime });
        const code = result.code;

        assert.match(code, /async def alpha\(\):/);
        assert.match(code, /async def beta\(\):/);
        assert.match(code, /asyncio\.create_task\(alpha\(\)\)/);
        assert.match(code, /asyncio\.create_task\(beta\(\)\)/);
        assert.match(code, /await asyncio\.gather\(\*tasks\)/);
    });

    it('drops a disabled continuous graph from the output', async () => {
        const runtime = buildRuntime();
        const alpha = new MockGraph('alpha', 'Alpha', 'continuous', true);
        alpha.addNode('1', buildNode('emit', '1', runtime, { value: 1 }));
        const beta = new MockGraph('beta', 'Beta', 'continuous', false);
        beta.addNode('2', buildNode('emit', '2', runtime, { value: 2 }));

        const collection = new MockCollection();
        collection.addGraph('alpha', alpha);
        collection.addGraph('beta', beta);

        const result = await buildTranspiler().transpile(collection, { deviceRuntime: runtime });
        const code = result.code;

        assert.match(code, /async def alpha\(\):/);
        assert.match(code, /await alpha\(\)/);
        assert.doesNotMatch(code, /async def beta\(\):/);
        assert.doesNotMatch(code, /beta\(\)/);
        assert.doesNotMatch(code, /asyncio\.gather\(\*tasks\)/);
    });

    it('drops imports that only the disabled graph needed', async () => {
        const runtime = buildRuntime();

        // The enabled graph needs the module, so the import survives ...
        const shared = new MockCollection();
        const sharedAlpha = new MockGraph('alpha', 'Alpha', 'continuous', true);
        sharedAlpha.addNode('1', buildNode('import-needing', '1', runtime));
        const sharedBeta = new MockGraph('beta', 'Beta', 'continuous', false);
        sharedBeta.addNode('2', buildNode('import-needing', '2', runtime));
        shared.addGraph('alpha', sharedAlpha);
        shared.addGraph('beta', sharedBeta);

        const withImport = await buildTranspiler().transpile(shared, { deviceRuntime: runtime });
        assert.match(withImport.code, /import machine/);

        // ... but once only the disabled graph needs it, it disappears.
        const onlyDisabled = new MockCollection();
        const plainAlpha = new MockGraph('alpha', 'Alpha', 'continuous', true);
        plainAlpha.addNode('1', buildNode('emit', '1', runtime, { value: 1 }));
        const disabledBeta = new MockGraph('beta', 'Beta', 'continuous', false);
        disabledBeta.addNode('2', buildNode('import-needing', '2', runtime));
        onlyDisabled.addGraph('alpha', plainAlpha);
        onlyDisabled.addGraph('beta', disabledBeta);

        const withoutImport = await buildTranspiler().transpile(onlyDisabled, {
            deviceRuntime: runtime,
        });
        assert.doesNotMatch(withoutImport.code, /import machine/);
    });

    it('treats graphs without an enabled accessor as enabled', async () => {
        const runtime = buildRuntime();
        const legacy = new MockGraph('legacy', 'Legacy', 'continuous');
        legacy.addNode('1', buildNode('emit', '1', runtime, { value: 1 }));

        const collection = new MockCollection();
        collection.addGraph('legacy', new MockGraphWithoutEnabled(legacy));

        const result = await buildTranspiler().transpile(collection, { deviceRuntime: runtime });

        assert.match(result.code, /async def legacy\(\):/);
        assert.match(result.code, /await legacy\(\)/);
    });

    it('skips validation for disabled graphs', async () => {
        const runtime = buildRuntime();
        const alpha = new MockGraph('alpha', 'Alpha', 'continuous', true);
        alpha.addNode('1', buildNode('emit', '1', runtime, { value: 1 }));

        // Validation would reject the unknown node type of the disabled graph.
        const broken = new MockGraph('broken', 'Broken', 'continuous', false);
        broken.addNode('2', new MockNodeData({ id: '2', type: 'unknown-type' }));

        const collection = new MockCollection();
        collection.addGraph('alpha', alpha);
        collection.addGraph('broken', broken);

        const result = await buildTranspiler().transpile(collection, { deviceRuntime: runtime });

        assert.match(result.code, /async def alpha\(\):/);
        assert.doesNotMatch(result.code, /broken/);

        // Control: the same graph fails validation as soon as it is enabled again.
        broken.enabled = true;
        await assert.rejects(
            buildTranspiler().transpile(collection, { deviceRuntime: runtime }),
            /Missing node definition for type: unknown-type/
        );
    });

    it('rejects a collection whose graphs are all disabled', async () => {
        const runtime = buildRuntime();
        const alpha = new MockGraph('alpha', 'Alpha', 'continuous', false);
        alpha.addNode('1', buildNode('emit', '1', runtime, { value: 1 }));

        const collection = new MockCollection();
        collection.addGraph('alpha', alpha);

        await assert.rejects(
            buildTranspiler().transpile(collection, { deviceRuntime: runtime }),
            /Collection has no enabled graphs to transpile/
        );
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
