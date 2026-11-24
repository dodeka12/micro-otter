import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

class MockCollection {
    constructor(id, version = '1.0.0') {
        this.id = id;
        this.version = version;
        this.graphs = new Map();
        this.deviceRuntimeId = 'general';
    }

    getId() {
        return this.id;
    }

    getVersion() {
        return this.version;
    }

    getDeviceRuntimeId() {
        return this.deviceRuntimeId;
    }

    addGraph(id, graph) {
        this.graphs.set(id, graph);
    }

    getGraphs() {
        const result = {};
        this.graphs.forEach((graph, id) => {
            result[id] = graph;
        });
        return result;
    }
}

class MockNodeGraph {
    constructor(id, name, intervalMs = 100) {
        this.id = id;
        this.name = name;
        this.intervalMs = intervalMs;
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
        return this.intervalMs;
    }

    addNode(id, node) {
        this.nodes.set(id, node);
    }

    getNodes() {
        const result = {};
        this.nodes.forEach((node, id) => {
            result[id] = node;
        });
        return result;
    }

    getConnections() {
        return this.connections.slice();
    }
}

class MockNodeData {
    constructor({ id, type }) {
        this.id = id;
        this.type = type;
        this.title = type;
        this.inputs = [];
        this.outputs = [{ id: 'out0', name: 'Value' }];
        this.controls = [];
        this.controlValues = {};
        this.inputDefaults = {};
    }

    getId() {
        return this.id;
    }

    getType() {
        return this.type;
    }

    getTitle() {
        return this.title;
    }
}

class MockDeviceRuntime {
    constructor() {
        this.nodeDefinitions = new Map();
    }

    addNodeDefinition(type, definition) {
        this.nodeDefinitions.set(type, definition);
    }

    getNodeDefinition(type) {
        return this.nodeDefinitions.get(type);
    }
}

function createNodeDefinition({ packageId = 'core', mpAssets = [], mpModuleRoots = [] } = {}) {
    return {
        packageId,
        inputs: [],
        outputs: [{ id: 'out0', name: 'Value' }],
        controls: [],
        implementations: {
            python: {
                type: 'regex',
                value: '0',
            },
        },
        mpAssets,
        mpModuleRoots,
    };
}

async function transpileGraphWithNodes(nodeTypes) {
    const deviceRuntime = new MockDeviceRuntime();
    const transpiler = new Transpiler({ logger: { log: () => {} } });

    deviceRuntime.addNodeDefinition(
        'pkgA_node',
        createNodeDefinition({
            packageId: 'pkgA',
            mpAssets: [
                'nodes/packages/pkgA/libs/a1.py',
                'nodes\\packages\\pkgA\\libs\\sub\\a2.py',
                'nodes/packages/pkgA/libs/a1.py',
            ],
            mpModuleRoots: ['nodes/packages/pkgA/libs', 'nodes/packages/pkgA/modules/'],
        })
    );

    deviceRuntime.addNodeDefinition(
        'pkgB_node',
        createNodeDefinition({
            packageId: 'pkgB',
            mpAssets: ['nodes/packages/pkgB/libs/b1.py'],
            mpModuleRoots: ['nodes/packages/pkgB/libs'],
        })
    );

    deviceRuntime.addNodeDefinition(
        'core_node',
        createNodeDefinition({
            packageId: 'core',
            mpAssets: ['nodes/packages/core/libs/core.py'],
            mpModuleRoots: [],
        })
    );

    deviceRuntime.addNodeDefinition(
        'empty_node',
        createNodeDefinition({
            packageId: 'core',
            mpAssets: [],
            mpModuleRoots: [],
        })
    );

    deviceRuntime.addNodeDefinition(
        'legacy_pkg_node',
        createNodeDefinition({
            packageId: 'legacy',
            mpAssets: ['pkg/legacy/file1.py', 'pkg/legacy/file2.py', 'pkg/legacy/file1.py'],
            mpModuleRoots: ['pkg/legacy/lib'],
        })
    );

    const collection = new MockCollection('col-1');
    const graph = new MockNodeGraph('graph-1', 'AssetsGraph');

    nodeTypes.forEach((type, index) => {
        graph.addNode(`node-${index}`, new MockNodeData({ id: `node-${index}`, type }));
    });

    collection.addGraph('graph-1', graph);

    return transpiler.transpile(collection, { deviceRuntime });
}

describe('Transpiler package asset planning', () => {
    it('relativizes and deduplicates package assets and module roots', async () => {
        const result = await transpileGraphWithNodes(['pkgA_node', 'pkgB_node', 'core_node']);
        const packages = result.assets?.packages || {};

        assert.deepEqual(Object.keys(packages).sort(), ['core', 'pkgA', 'pkgB']);

        assert.deepEqual(packages.pkgA.files, ['a1.py', 'sub/a2.py']);
        assert.deepEqual(packages.pkgA.moduleRoots, ['libs', 'modules']);

        assert.deepEqual(packages.pkgB.files, ['b1.py']);
        assert.deepEqual(packages.pkgB.moduleRoots, ['libs']);

        assert.deepEqual(packages.core.files, ['core.py']);
        assert.deepEqual(packages.core.moduleRoots, []);
    });

    it('includes only packages referenced by used node types', async () => {
        const result = await transpileGraphWithNodes(['pkgA_node', 'core_node']);
        const packages = result.assets?.packages || {};

        assert.deepEqual(Object.keys(packages).sort(), ['core', 'pkgA']);
        assert.equal(packages.pkgB, undefined);
        assert.deepEqual(packages.pkgA.files, ['a1.py', 'sub/a2.py']);
    });

    it('omits package entries when both files and module roots are empty', async () => {
        const result = await transpileGraphWithNodes(['empty_node']);
        assert.deepEqual(result.assets?.packages || {}, {});
    });

    it('normalizes pkg/<id> asset roots and keeps only used legacy package', async () => {
        const result = await transpileGraphWithNodes(['legacy_pkg_node']);
        const packages = result.assets?.packages || {};

        assert.deepEqual(Object.keys(packages), ['legacy']);
        assert.deepEqual(packages.legacy.files, ['file1.py', 'file2.py']);
        assert.deepEqual(packages.legacy.moduleRoots, ['lib']);
    });
});